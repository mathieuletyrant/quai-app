import {
  type ApnsEnvironment,
  ApnsEnvironment as ApnsEnvironmentSchema,
  type DeviceId,
  type DevicePreferences,
  DevicePreferences as DevicePreferencesSchema,
  type HomeOffline
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { isTimeZone } from "../releases/Day.ts"
import { HomeDocuments, toOffline } from "./HomeLink.ts"

export const Timing = {
  /** A pairing code (the console's QR code) is valid this long, and only once. */
  pairingCodeMs: 10 * 60_000,
  /** `lastSeenAt` is written back at most this often: not one home write per request. */
  lastSeenMs: 60_000
} as const

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** 8 characters, no look-alikes (0/O, 1/I/L), easy to type when the camera can't scan. */
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const newCode = () =>
  Array.from(randomBytes(8), (b) => codeAlphabet[b % codeAlphabet.length]).join("")

export interface Device {
  readonly id: DeviceId
  readonly name: string
  readonly apnsEnvironment: ApnsEnvironment
  readonly pushToStartToken: string | null
  readonly pairedAt: number
  readonly lastSeenAt: number | null
  readonly timeZone: string | null
}

/** One iPhone as the notifier sees it for one activity. */
export interface PushTarget {
  readonly deviceId: DeviceId
  /** As its owner named it: for the journal. */
  readonly name: string
  readonly apnsEnvironment: ApnsEnvironment
  readonly pushToStartToken: string | null
  /** The token of this activity on this iPhone, once the iPhone reported it. */
  readonly activityToken: string | null
  readonly preferences: DevicePreferences
  /** Where the activity was when this iPhone's user swiped it away, if they did. */
  readonly dismissed: Dismissed | null
}

/** An activity as it was when it was swiped away: a change from this shows it again. */
export interface Dismissed {
  readonly stepIndex: number
  readonly paused: boolean | null
}

export const defaultPreferences: DevicePreferences = { flows: {} }

/** Where a push for one activity goes: one row per iPhone that can receive it. */
export interface Recipient {
  readonly deviceId: DeviceId
  readonly apnsEnvironment: ApnsEnvironment
  readonly token: string
}

/** `devices/<id>`: one paired iPhone. Its bearer token is kept as a SHA-256 hash only. */
export const DeviceDocument = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tokenHash: Schema.String,
  apnsEnvironment: ApnsEnvironmentSchema,
  pushToStartToken: Schema.NullOr(Schema.String),
  pairedAt: Schema.Number,
  lastSeenAt: Schema.NullOr(Schema.Number),
  preferences: DevicePreferencesSchema,
  /** IANA, as the iPhone reported it; absent on iPhones paired before. */
  timeZone: Schema.optional(Schema.String),
  /** Activity key → the push token this iPhone reported for it. */
  activityTokens: Schema.Record(Schema.String, Schema.String),
  /** Activity key → where it was when swiped away. */
  dismissed: Schema.Record(Schema.String, Schema.Struct({ stepIndex: Schema.Number, paused: Schema.NullOr(Schema.Boolean) }))
})
export type DeviceDocument = typeof DeviceDocument.Type

/** `pairing/<SHA-256 of the code>`: a code not used yet. Spending it deletes it. */
export const PairingDocument = Schema.Struct({ expiresAt: Schema.Number })

export const deviceKey = (id: string) => `devices/${id}`
export const pairingKey = (code: string) => `pairing/${sha256(code)}`

const decodeDevice = Schema.decodeUnknownOption(DeviceDocument)
const decodePairing = Schema.decodeUnknownOption(PairingDocument)

const toDevice = (d: DeviceDocument): Device => ({
  id: d.id as DeviceId,
  name: d.name,
  apnsEnvironment: d.apnsEnvironment,
  pushToStartToken: d.pushToStartToken,
  pairedAt: d.pairedAt,
  lastSeenAt: d.lastSeenAt,
  timeZone: d.timeZone ?? null
})

export class Devices extends Context.Service<Devices, {
  readonly createPairingCode: Effect.Effect<{ readonly code: string; readonly expiresAt: number }, HomeOffline>
  /** Spends a pairing code; `None` when it is unknown, used or expired. */
  readonly pair: (input: {
    readonly code: string
    readonly name: string
    readonly apnsEnvironment: ApnsEnvironment
    readonly pushToStartToken?: string | undefined
    readonly timeZone?: string | undefined
  }) => Effect.Effect<Option.Option<{ readonly deviceId: DeviceId; readonly token: string }>, HomeOffline>
  readonly authenticate: (token: string) => Effect.Effect<Option.Option<Device>, HomeOffline>
  readonly update: (
    id: DeviceId,
    patch: { readonly name?: string | undefined; readonly pushToStartToken?: string | undefined; readonly timeZone?: string | undefined }
  ) => Effect.Effect<void, HomeOffline>
  /** The time zone of the most recently seen iPhone that reported a valid one. */
  readonly timeZone: Effect.Effect<Option.Option<string>, HomeOffline>
  readonly setActivityToken: (id: DeviceId, activityKey: string, pushToken: string) => Effect.Effect<void, HomeOffline>
  readonly list: Effect.Effect<ReadonlyArray<Device>, HomeOffline>
  readonly remove: (id: DeviceId) => Effect.Effect<boolean, HomeOffline>
  /** iPhones that can be woken with push-to-start. */
  readonly startRecipients: Effect.Effect<ReadonlyArray<Recipient>, HomeOffline>
  /** iPhones that told us the push token of this activity. */
  readonly activityRecipients: (activityKey: string) => Effect.Effect<ReadonlyArray<Recipient>, HomeOffline>
  readonly preferences: (id: DeviceId) => Effect.Effect<DevicePreferences, HomeOffline>
  readonly setPreferences: (id: DeviceId, preferences: DevicePreferences) => Effect.Effect<DevicePreferences, HomeOffline>
  /** Every iPhone, with its tokens for this activity and its preferences. */
  readonly targets: (activityKey: string) => Effect.Effect<ReadonlyArray<PushTarget>, HomeOffline>
  /**
   * The iPhone reports the activities still on its screen: the others were swiped away, so their
   * tokens go and `stateOf` records where they were.
   */
  readonly reconcile: (id: DeviceId, shownKeys: ReadonlyArray<string>, stateOf: (key: string) => Dismissed | null) => Effect.Effect<void, HomeOffline>
  /** The activity is on this iPhone again. */
  readonly clearDismissed: (id: DeviceId, activityKey: string) => Effect.Effect<void, HomeOffline>
  /** APNs said this token is dead: forget it. */
  readonly dropToken: (token: string) => Effect.Effect<void, HomeOffline>
}>()("quai/Devices") {
  /** The paired iPhones, as home documents. */
  static readonly layer = Layer.effect(
    Devices,
    Effect.gen(function*() {
      const store = yield* HomeDocuments
      // Changes read, then write, a document: one at a time, so two can't spend one code.
      const lock = yield* Semaphore.make(1)
      const exclusive = <A, E>(effect: Effect.Effect<A, E>) => Semaphore.withPermits(lock, 1)(effect)

      const all = store.list("devices/").pipe(
        Effect.map((docs) => docs.flatMap((d) => Option.toArray(decodeDevice(d.value)))),
        Effect.mapError(toOffline)
      )
      const one = (id: DeviceId) =>
        store.get(deviceKey(id)).pipe(Effect.map(Option.flatMap(decodeDevice)), Effect.mapError(toOffline))
      const save = (device: DeviceDocument) => Effect.mapError(store.put(deviceKey(device.id), device), toOffline)
      /** Applies `change` to one iPhone; nothing when it isn't paired (anymore). */
      const change = (id: DeviceId, f: (device: DeviceDocument) => DeviceDocument) =>
        exclusive(Effect.gen(function*() {
          const device = yield* one(id)
          if (Option.isNone(device)) return
          const changed = f(device.value)
          if (changed !== device.value) yield* save(changed)
        }))
      const recipients = (pick: (d: DeviceDocument) => string | null | undefined) =>
        Effect.map(all, (devices) =>
          devices.flatMap((d): ReadonlyArray<Recipient> => {
            const token = pick(d)
            return token === null || token === undefined
              ? []
              : [{ deviceId: d.id as DeviceId, apnsEnvironment: d.apnsEnvironment, token }]
          }))
      const without = <V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> => {
        const { [key]: _, ...rest } = record
        return rest
      }

      return {
        createPairingCode: exclusive(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const code = newCode()
          const expiresAt = now + Timing.pairingCodeMs
          for (const doc of yield* Effect.mapError(store.list("pairing/"), toOffline)) {
            const pairing = decodePairing(doc.value)
            if (Option.isNone(pairing) || pairing.value.expiresAt < now) yield* Effect.mapError(store.delete(doc.key), toOffline)
          }
          yield* Effect.mapError(store.put(pairingKey(code), { expiresAt }), toOffline)
          return { code, expiresAt }
        })),

        pair: (input) =>
          exclusive(Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const key = pairingKey(input.code.trim().toUpperCase())
            const pairing = Option.flatMap(yield* Effect.mapError(store.get(key), toOffline), decodePairing)
            if (Option.isNone(pairing)) return Option.none()
            yield* Effect.mapError(store.delete(key), toOffline)
            if (pairing.value.expiresAt < now) return Option.none()
            const deviceId = randomUUID() as DeviceId
            const token = randomBytes(32).toString("base64url")
            yield* save({
              id: deviceId,
              name: input.name,
              tokenHash: sha256(token),
              apnsEnvironment: input.apnsEnvironment,
              pushToStartToken: input.pushToStartToken ?? null,
              pairedAt: now,
              lastSeenAt: now,
              preferences: defaultPreferences,
              ...(input.timeZone !== undefined && isTimeZone(input.timeZone) ? { timeZone: input.timeZone } : {}),
              activityTokens: {},
              dismissed: {}
            })
            return Option.some({ deviceId, token })
          })),

        authenticate: (token) =>
          Effect.gen(function*() {
            const hash = sha256(token)
            const device = (yield* all).find((d) => d.tokenHash === hash)
            if (device === undefined) return Option.none()
            const now = yield* Clock.currentTimeMillis
            if (device.lastSeenAt === null || now - device.lastSeenAt >= Timing.lastSeenMs) {
              yield* change(device.id as DeviceId, (d) => ({ ...d, lastSeenAt: now }))
              return Option.some(toDevice({ ...device, lastSeenAt: now }))
            }
            return Option.some(toDevice(device))
          }),

        update: (id, patch) =>
          change(id, (d) => ({
            ...d,
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.pushToStartToken === undefined ? {} : { pushToStartToken: patch.pushToStartToken }),
            ...(patch.timeZone === undefined || !isTimeZone(patch.timeZone) ? {} : { timeZone: patch.timeZone })
          })),

        timeZone: Effect.map(all, (devices) =>
          Option.fromNullishOr(
            [...devices]
              .filter((d) => d.timeZone !== undefined && isTimeZone(d.timeZone))
              .sort((a, b) => (b.lastSeenAt ?? b.pairedAt) - (a.lastSeenAt ?? a.pairedAt))[0]?.timeZone
          )),

        setActivityToken: (id, activityKey, pushToken) =>
          change(id, (d) => ({
            ...d,
            activityTokens: { ...d.activityTokens, [activityKey]: pushToken },
            dismissed: without(d.dismissed, activityKey)
          })),

        list: Effect.map(all, (devices) => [...devices].sort((a, b) => a.pairedAt - b.pairedAt).map(toDevice)),

        remove: (id) =>
          exclusive(Effect.gen(function*() {
            if (Option.isNone(yield* one(id))) return false
            yield* Effect.mapError(store.delete(deviceKey(id)), toOffline)
            return true
          })),

        startRecipients: recipients((d) => d.pushToStartToken),

        activityRecipients: (activityKey) => recipients((d) => d.activityTokens[activityKey]),

        preferences: (id) => Effect.map(one(id), Option.match({ onNone: () => defaultPreferences, onSome: (d) => d.preferences })),

        setPreferences: (id, preferences) => Effect.as(change(id, (d) => ({ ...d, preferences })), preferences),

        targets: (activityKey) =>
          Effect.map(all, (devices) =>
            devices.map((d): PushTarget => ({
              deviceId: d.id as DeviceId,
              name: d.name,
              apnsEnvironment: d.apnsEnvironment,
              pushToStartToken: d.pushToStartToken,
              activityToken: d.activityTokens[activityKey] ?? null,
              preferences: d.preferences,
              dismissed: d.dismissed[activityKey] ?? null
            }))),

        reconcile: (id, shownKeys, stateOf) =>
          change(id, (d) => {
            const shown = new Set(shownKeys)
            const gone = Object.keys(d.activityTokens).filter((key) => !shown.has(key))
            if (gone.length === 0) return d
            const activityTokens = { ...d.activityTokens }
            const dismissed = { ...d.dismissed }
            for (const key of gone) {
              delete activityTokens[key]
              const state = stateOf(key)
              if (state !== null) dismissed[key] = state
            }
            return { ...d, activityTokens, dismissed }
          }),

        clearDismissed: (id, activityKey) =>
          change(id, (d) => d.dismissed[activityKey] === undefined ? d : { ...d, dismissed: without(d.dismissed, activityKey) }),

        dropToken: (token) =>
          Effect.gen(function*() {
            for (const device of yield* all) {
              const holds = device.pushToStartToken === token || Object.values(device.activityTokens).includes(token)
              if (!holds) continue
              yield* change(device.id as DeviceId, (d) => ({
                ...d,
                pushToStartToken: d.pushToStartToken === token ? null : d.pushToStartToken,
                activityTokens: Object.fromEntries(Object.entries(d.activityTokens).filter(([, t]) => t !== token))
              }))
            }
          })
      }
    })
  )
}
