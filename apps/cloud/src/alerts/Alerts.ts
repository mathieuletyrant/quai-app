import {
  type ActiveAlert,
  type ActiveAlerts,
  type AlertKind,
  AlertKind as AlertKindSchema,
  type AlertSettings,
  AlertSettings as AlertSettingsSchema,
  alertKinds,
  currentAlertKind as currentKind,
  defaultAlertSettings,
  type HomeOffline,
  type JournalSource,
  journalSources
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { Devices } from "../home/Devices.ts"
import { HomeDocuments, toOffline } from "../home/HomeLink.ts"
import { Journal } from "../journal/Journal.ts"
import { Apns, ApnsError } from "../push/Apns.ts"

/** One alert a reading found: `what` tells it apart from the others of its kind and scope. */
export interface Raised {
  readonly what: string
  /** The notification's title, and the alert's on the app's Home: "Radarr isn't answering". */
  readonly title: string
  /** The notification's text: "No answer for 5 minutes". */
  readonly detail?: string
  /** The notification when it's over: "Radarr answers again". */
  readonly over: string
  /** Over without a notification: a planned deletion ends because it was handled, mostly by the user. */
  readonly silentOver?: boolean
}

/**
 * What one reading says about one kind of alert, for one scope (a service, or `disk`): exactly the
 * alerts going on now. Those of that kind and scope not listed are over.
 */
export interface AlertState {
  readonly _tag: "AlertState"
  readonly kind: AlertKind
  readonly scope: string
  readonly raised: ReadonlyArray<Raised>
}

export const alertState = (kind: AlertKind, scope: string, raised: ReadonlyArray<Raised>): AlertState =>
  ({ _tag: "AlertState", kind, scope, raised })

/** `alerts/settings`, `alerts/active`: home documents, so a restarted Cloud doesn't notify again. */
export const settingsKey = "alerts/settings"
export const activeKey = "alerts/active"

const StoredAlert = Schema.Struct({
  id: Schema.String,
  kind: AlertKindSchema,
  scope: Schema.String,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  over: Schema.String,
  silentOver: Schema.optionalKey(Schema.Boolean),
  since: Schema.Number
})
type StoredAlert = typeof StoredAlert.Type

const renamedKeys = (doc: object): object =>
  Object.fromEntries(Object.entries(doc).map(([key, value]) => [String(currentKind(key)), value]))

/** An alert stored under an older kind: its kind and the start of its id follow. */
const renamedAlert = (alert: unknown): unknown => {
  if (typeof alert !== "object" || alert === null || !("kind" in alert) || !("id" in alert)) return alert
  const kind = currentKind(alert.kind)
  if (kind === alert.kind || typeof alert.id !== "string") return alert
  return { ...alert, kind, id: `${String(kind)}${alert.id.slice(String(alert.kind).length)}` }
}

const decodeAlertSettings = Schema.decodeUnknownOption(AlertSettingsSchema)
/** Saved before a kind existed, the settings get its defaults; the others are kept. */
const decodeSettings = (doc: unknown) =>
  decodeAlertSettings(typeof doc === "object" && doc !== null ? { ...defaultAlertSettings, ...renamedKeys(doc) } : doc)
const decodeStoredAlerts = Schema.decodeUnknownOption(Schema.Array(StoredAlert))
const decodeActive = (doc: unknown) => decodeStoredAlerts(Array.isArray(doc) ? doc.map(renamedAlert) : doc)

export const alertId = (kind: AlertKind, scope: string, what: string) => `${kind}:${scope}:${what}`

/** What changes when a reading comes in: the alerts that start, those over, and the new list. */
export const reconcile = (stored: ReadonlyArray<StoredAlert>, state: AlertState, now: number) => {
  const mine = (alert: StoredAlert) => alert.kind === state.kind && alert.scope === state.scope
  const raisedIds = new Map(state.raised.map((raised) => [alertId(state.kind, state.scope, raised.what), raised]))
  const over = stored.filter((alert) => mine(alert) && !raisedIds.has(alert.id))
  const started: Array<StoredAlert> = []
  const next: Array<StoredAlert> = []
  for (const alert of stored) {
    if (!mine(alert)) {
      next.push(alert)
      continue
    }
    const raised = raisedIds.get(alert.id)
    if (raised === undefined) continue
    // Still going: its text follows the reading (the disk's free space), no new notification.
    const { detail: _, silentOver: __, ...rest } = alert
    next.push({
      ...rest,
      title: raised.title,
      over: raised.over,
      ...(raised.detail === undefined ? {} : { detail: raised.detail }),
      ...(raised.silentOver === true ? { silentOver: true } : {})
    })
  }
  for (const [id, raised] of raisedIds) {
    if (stored.some((alert) => alert.id === id)) continue
    const alert: StoredAlert = {
      id,
      kind: state.kind,
      scope: state.scope,
      title: raised.title,
      over: raised.over,
      since: now,
      ...(raised.detail === undefined ? {} : { detail: raised.detail }),
      ...(raised.silentOver === true ? { silentOver: true } : {})
    }
    started.push(alert)
    next.push(alert)
  }
  return { started, over, next, changed: JSON.stringify(next) !== JSON.stringify(stored) }
}

const sourceOf = (scope: string): JournalSource =>
  (journalSources as ReadonlyArray<string>).includes(scope) ? (scope as JournalSource) : "cloud"

const enabledKinds = (settings: AlertSettings): ReadonlyArray<AlertKind> => alertKinds.filter((kind) => settings[kind].enabled)

const toActive = (alert: StoredAlert): ActiveAlert => ({
  id: alert.id,
  kind: alert.kind,
  title: alert.title,
  since: alert.since,
  ...(alert.detail === undefined ? {} : { detail: alert.detail })
})

/**
 * The alerts: their settings, the ones going on, and what a reading changes. An alert that starts
 * or ends is one notification to each iPhone that allowed them and didn't mute its kind, and one
 * line in the journal.
 */
export class Alerts extends Context.Service<Alerts, {
  readonly settings: Effect.Effect<AlertSettings, HomeOffline>
  /** Saves them; the alerts of a kind turned off end without a notification. */
  readonly saveSettings: (settings: AlertSettings) => Effect.Effect<AlertSettings, HomeOffline>
  readonly active: Effect.Effect<ActiveAlerts, HomeOffline>
  /** One reading. Never fails: an offline home or a refused push is logged. */
  readonly apply: (state: AlertState) => Effect.Effect<void>
}>()("quai/Alerts") {
  static readonly layer = Layer.effect(
    Alerts,
    Effect.gen(function*() {
      const store = yield* HomeDocuments
      const devices = yield* Devices
      const apns = yield* Apns
      const journal = yield* Journal
      // Readings of different services arrive together: one read-change-write at a time.
      const lock = yield* Semaphore.make(1)

      const settings = Effect.map(
        Effect.mapError(store.get(settingsKey), toOffline),
        (doc) => Option.getOrElse(Option.flatMap(doc, decodeSettings), () => defaultAlertSettings)
      )
      const stored = Effect.map(
        Effect.mapError(store.get(activeKey), toOffline),
        (doc) => Option.getOrElse(Option.flatMap(doc, decodeActive), (): ReadonlyArray<StoredAlert> => [])
      )
      const saveStored = (alerts: ReadonlyArray<StoredAlert>) => Effect.mapError(store.put(activeKey, alerts), toOffline)

      const notify = (alert: StoredAlert, title: string, body: string | undefined) =>
        Effect.gen(function*() {
          for (const recipient of yield* devices.alertRecipients(alert.kind)) {
            yield* apns.send({
              pushType: "alert",
              environment: recipient.apnsEnvironment,
              deviceToken: recipient.token,
              priority: 10,
              body: { aps: { alert: body === undefined ? { title } : { title, body }, sound: "default", "thread-id": alert.kind } }
            }).pipe(
              Effect.catchTag("ApnsError", (error: ApnsError) =>
                Effect.andThen(
                  journal.log({ level: "error", source: "apple", kind: "push.refused", text: `Apple refused the alert for ${recipient.name}: ${error.reason}`, deviceName: recipient.name }),
                  error.tokenGone ? devices.dropToken(recipient.token).pipe(Effect.ignore) : Effect.void
                ))
            )
          }
        })

      const apply = (state: AlertState) =>
        Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
          if (!(yield* settings)[state.kind].enabled) return
          const now = yield* Clock.currentTimeMillis
          const change = reconcile(yield* stored, state, now)
          if (!change.changed) return
          yield* saveStored(change.next)
          for (const alert of change.started) {
            yield* journal.log({ level: "warn", source: sourceOf(alert.scope), kind: "alert.raised", text: alert.detail === undefined ? alert.title : `${alert.title}: ${alert.detail}` })
            yield* notify(alert, alert.title, alert.detail)
          }
          for (const alert of change.over) {
            yield* journal.log({ level: "info", source: sourceOf(alert.scope), kind: "alert.over", text: alert.over })
            if (alert.silentOver !== true) yield* notify(alert, alert.over, undefined)
          }
        })).pipe(
          Effect.catchTag("HomeOffline", (error) => Effect.logWarning(`alert not applied: ${error.message}`))
        )

      return {
        settings,
        saveSettings: (next) =>
          Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
            yield* Effect.mapError(store.put(settingsKey, next), toOffline)
            const kept = (yield* stored).filter((alert) => next[alert.kind].enabled)
            yield* saveStored(kept)
            return next
          })),
        active: Effect.gen(function*() {
          const current = yield* settings
          const items = (yield* stored).filter((alert) => current[alert.kind].enabled).map(toActive)
          return { items, enabled: enabledKinds(current) }
        }),
        apply
      }
    })
  )
}
