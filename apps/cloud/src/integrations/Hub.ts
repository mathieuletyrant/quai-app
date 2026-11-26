import { defaultAlertSettings, HomeProtocol, journalSourceNames, type ServiceName } from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schedule } from "effect"
import { Alerts } from "../alerts/Alerts.ts"
import { Activities } from "../flows/Activities.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { Gone, type GoneItem } from "../gone/Gone.ts"
import { type HomeEvent, HomeLink, type LinkedHome } from "../home/HomeLink.ts"
import { HomeTime } from "../home/HomeTime.ts"
import { eventNote, type From } from "../journal/describe.ts"
import { Journal } from "../journal/Journal.ts"
import { Notifier } from "../push/Notifier.ts"
import { departureOf, DiskReadings } from "../storage/DiskReadings.ts"
import {
  type Integration,
  Integrations,
  isAlertState,
  isGone,
  type Signal,
  type WatchContext,
  type Watcher
} from "./Integration.ts"

/** The engine's housekeeping pace, and how often the watches are checked against the flows. */
export const heartbeat = "5 seconds"

/**
 * A link that comes back within this is a reconnection, not an outage: the hosted Cloud's
 * WebSocket drops a few times a day when Cloudflare moves the Durable Object in front of it, and
 * Quai Home is back within seconds.
 */
export const offlineGraceMs = 60_000

/** "Radarr, Sonarr", or "no service". */
const servicesText = (services: LinkedHome["services"]) =>
  services.length === 0 ? "no service" : services.map((service) => journalSourceNames[service]).join(", ")

/** What the journal says when Quai Home links. */
const linkedNote = (home: LinkedHome) => {
  const services = servicesText(home.services)
  return home.protocol < HomeProtocol.journalProtocolVersion
    ? {
      level: "warn" as const,
      text: `Quai Home linked (${services}); it is too old to keep the journal: update it to keep the history`
    }
    : { level: "info" as const, text: `Quai Home linked (${services})` }
}

/** The same event about the same title twice in a row (a poll that repeats it) is logged once. */
const makeRepeats = () => {
  const last = new Map<string, string>()
  return (event: FlowEvent): boolean => {
    const key = `${event.flowId ?? ""}|${event.subject?.key ?? ""}`
    const what = `${event.type}|${event.downloadId ?? ""}`
    if (last.get(key) === what) return true
    last.delete(key)
    last.set(key, what)
    if (last.size > 1000) last.delete(last.keys().next().value!)
    return false
  }
}

type EventOf<Tag extends HomeEvent["_tag"]> = Extract<HomeEvent, { readonly _tag: Tag }>

interface Owner {
  readonly integration: Integration
  readonly watcher: Watcher<Signal>
  readonly watch: HomeProtocol.Watch
}

interface Sent {
  /** The watch list as sent, to send it again only when it changes. */
  readonly fingerprint: string
  readonly owners: ReadonlyMap<string, Owner>
}

/** An integration's watchers: its flow events', its alerts', then what it says is gone. */
const watchersOf = (integration: Integration): ReadonlyArray<Watcher<Signal>> =>
  [integration.watcher, integration.alertWatcher, integration.goneWatcher].filter((watcher) => watcher !== undefined)

/** A watch's owner, for the watches of the services Quai Home reaches; the first integration to ask wins. */
const watchOwners = (integrations: ReadonlyArray<Integration>, ctx: WatchContext): Map<string, Owner> => {
  const asked = integrations.flatMap((integration) =>
    watchersOf(integration).flatMap((watcher) => watcher.watches(ctx).map((watch) => ({ integration, watcher, watch })))
  )
  const owners = new Map<string, Owner>()
  for (const owner of asked) {
    if (ctx.services.includes(owner.watch.service) && !owners.has(owner.watch.id)) owners.set(owner.watch.id, owner)
  }
  return owners
}

const byId = (left: HomeProtocol.Watch, right: HomeProtocol.Watch) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

/**
 * Where what Quai Home sends meets the engine. Webhooks and watch snapshots go to their
 * integration, whose events go to the engine; the watches Quai Home polls follow what the flows and
 * the running activities need; a heartbeat runs the engine's housekeeping.
 */
export class Hub extends Context.Service<Hub, {
  readonly apply: (events: ReadonlyArray<FlowEvent>) => Effect.Effect<void>
  /** One heartbeat: the integrations' ticks, the engine's tick, then the watches. */
  readonly beat: Effect.Effect<void>
  /** Sends Quai Home the watches needed now, if they changed. */
  readonly sync: Effect.Effect<void>
  /** Has Quai Home read a service's watches again now (after an action). */
  readonly refresh: (service: ServiceName) => Effect.Effect<void>
  /** One event from Quai Home. */
  readonly handle: (event: HomeEvent) => Effect.Effect<void>
}>()("quai/Hub") {
  static readonly make = Effect.gen(function*() {
    const engine = yield* Activities
    const notifier = yield* Notifier
    const flows = yield* FlowStore
    const integrations = yield* Integrations
    const link = yield* HomeLink
    const time = yield* HomeTime
    const journal = yield* Journal
    const alerts = yield* Alerts
    const goneNotes = yield* Gone
    const diskReadings = yield* DiskReadings
    /** What Quai Home polls; null until sent to the home connected now. */
    let sent: Sent | null = null
    const repeated = makeRepeats()
    const scope = yield* Effect.scope
    /** Set while Quai Home is away; `logged` once the journal said so. Null while linked. */
    let gone: { logged: boolean } | null = null

    /** Logs the outage once Quai Home has been away longer than a reconnection takes. */
    const noteOutage = (drop: { logged: boolean }) =>
      Effect.sleep(offlineGraceMs).pipe(
        Effect.andThen(Effect.suspend(() => {
          if (gone !== drop) return Effect.void
          drop.logged = true
          return journal.log({
            level: "warn",
            source: "home",
            kind: "home.offline",
            text: "Quai Home went offline: nothing can be read or pushed until it's back"
          })
        })),
        Effect.forkIn(scope),
        Effect.asVoid
      )

    const apply = (events: ReadonlyArray<FlowEvent>) =>
      Effect.forEach(events, (event) => engine.handle(event, notifier.send), { discard: true })

    /** Something gone is a disk mark, and a notification for the iPhones that want it. */
    const goneNow = (item: GoneItem) => Effect.andThen(diskReadings.gone(departureOf(item)), goneNotes.notify(item))

    /** Alert states go to the alerts; flow events are logged, then applied. */
    const applyFrom = (service: From, signals: ReadonlyArray<Signal>) =>
      Effect.andThen(
        Effect.andThen(
          Effect.forEach(signals.filter(isAlertState), alerts.apply, { discard: true }),
          Effect.forEach(signals.filter(isGone), goneNow, { discard: true })
        ),
        applyEvents(
          service,
          signals.filter((signal): signal is FlowEvent => !isAlertState(signal) && !isGone(signal))
        )
      )

    /** Logs what the events of one service mean, then applies them. */
    const applyEvents = (service: From, events: ReadonlyArray<FlowEvent>) =>
      Effect.andThen(
        Effect.forEach(events, (event) => {
          const note = eventNote(event, service)
          return note === null || repeated(event) ? Effect.void : journal.log(note)
        }, { discard: true }),
        apply(events)
      )

    /** None while no home is connected. */
    const context: Effect.Effect<Option.Option<WatchContext>> = Effect.gen(function*() {
      const home = yield* link.home
      if (Option.isNone(home)) return Option.none()
      const { activities } = yield* engine.snapshot
      return Option.some({
        flows: yield* flows.all,
        running: [...activities.values()].filter((activity) => activity.endedAt === null),
        services: home.value.services,
        now: yield* Clock.currentTimeMillis,
        timeZone: yield* time.zone,
        alerts: yield* alerts.settings.pipe(Effect.orElseSucceed(() => defaultAlertSettings)),
        gone: yield* goneNotes.wanted.pipe(Effect.orElseSucceed(() => [])),
        protocol: home.value.protocol
      })
    }).pipe(Effect.orElseSucceed(() => Option.none()))

    const send = (force: boolean) =>
      Effect.gen(function*() {
        const ctx = yield* context
        if (Option.isNone(ctx)) return
        const owners = watchOwners(integrations, ctx.value)
        const watches = [...owners.values()].map((owner) => owner.watch).sort(byId)
        const fingerprint = JSON.stringify(watches)
        if (!force && sent?.fingerprint === fingerprint) return
        yield* link.setWatches(watches).pipe(
          Effect.tap(() => Effect.sync(() => (sent = { fingerprint, owners }))),
          Effect.catchTag("HomeError", (error) => Effect.logDebug(`watches not sent: ${error.message}`))
        )
      })
    const sync = send(false)

    /** Runs one integration's reading, then what it means, then the watches it may change. */
    const fromHome = (service: From, read: (ctx: WatchContext) => Effect.Effect<ReadonlyArray<Signal>>) =>
      Effect.gen(function*() {
        const ctx = yield* context
        if (Option.isNone(ctx)) return
        yield* applyFrom(service, yield* read(ctx.value))
        yield* sync
      })

    const linked = (event: EventOf<"Ready">) => {
      // A new connection: Quai Home starts with no watch.
      sent = null
      const dropped = gone
      gone = null
      // Back before the outage was logged: a reconnection, not news.
      if (dropped !== null && !dropped.logged) {
        return Effect.andThen(Effect.logInfo("Quai Home reconnected"), sync)
      }
      const { level, text } = linkedNote(event.home)
      return Effect.andThen(journal.log({ level, source: "home", kind: "home.linked", text }), sync)
    }

    const servicesChanged = (event: EventOf<"Services">) => {
      // Quai Home reaches other services now: the watches follow.
      sent = null
      return Effect.andThen(
        journal.log({
          level: "info",
          source: "home",
          kind: "home.services",
          text: `Quai Home's services changed: ${servicesText(event.home.services)}`
        }),
        sync
      )
    }

    const wentAway = () => {
      sent = null
      return Effect.suspend(() => {
        gone = { logged: false }
        return noteOutage(gone)
      })
    }

    const snapshot = (event: EventOf<"Snapshot">) => {
      const owner = sent?.owners.get(event.watchId)
      if (owner === undefined) return Effect.void
      return fromHome(
        owner.integration.service,
        (ctx) => owner.watcher.read({ watch: owner.watch, status: event.status, body: event.body }, ctx)
      )
    }

    const watchFailed = (event: EventOf<"WatchFailed">) => {
      const owner = sent?.owners.get(event.watchId)
      const failed = owner?.watcher.failed
      if (owner === undefined || failed === undefined) {
        return Effect.logDebug(`Quai Home could not read ${event.watchId}: ${event.reason}`)
      }
      return fromHome(owner.integration.service, (ctx) => failed(owner.watch, event.reason, ctx))
    }

    /** A webhook Quai can't read is logged and means nothing. */
    const unreadableWebhook = (service: EventOf<"Webhook">["service"]) =>
      Effect.as(
        Effect.andThen(
          Effect.logWarning(`${service} sent a webhook Quai can't read`),
          journal.log({
            level: "warn",
            source: service,
            kind: "webhook.unreadable",
            text: `${journalSourceNames[service]} sent a webhook Quai can't read`
          })
        ),
        []
      )

    const webhook = (event: EventOf<"Webhook">) => {
      const reader = integrations.find((integration) => integration.service === event.service)?.webhook
      if (reader === undefined) return Effect.void
      return fromHome(event.service, () =>
        reader.read(event.body).pipe(
          Effect.catchTag("SchemaError", () => unreadableWebhook(event.service))
        ))
    }

    const handle = (event: HomeEvent): Effect.Effect<void> => {
      switch (event._tag) {
        case "Ready":
          return linked(event)
        case "Services":
          return servicesChanged(event)
        case "Gone":
          return wentAway()
        case "Journal":
          return journal.noted(event.entries)
        case "Snapshot":
          return snapshot(event)
        case "WatchFailed":
          return watchFailed(event)
        case "Webhook":
          return webhook(event)
      }
    }

    const beat = Effect.gen(function*() {
      const ctx = yield* context
      if (Option.isNone(ctx)) return
      for (const integration of integrations) {
        for (const watcher of watchersOf(integration)) {
          if (watcher.tick !== undefined) yield* applyFrom(integration.service, yield* watcher.tick(ctx.value))
        }
      }
      yield* engine.tick(notifier.send)
      yield* sync
    })

    return {
      apply,
      beat,
      sync,
      // Quai Home reads every watch at once when it gets a list: sending it again is a refresh.
      refresh: (_service: ServiceName) => send(true),
      handle
    }
  })

  /** The Hub, fed by the home link, without heartbeat: tests call `beat` themselves. */
  static readonly layerFed = Layer.effect(
    Hub,
    Effect.gen(function*() {
      const hub = yield* Hub.make
      const link = yield* HomeLink
      yield* Effect.forever(
        Effect.flatMap(
          link.nextEvent,
          (event) =>
            hub.handle(event).pipe(
              Effect.catchCause((cause) => Effect.logError(`could not handle ${event._tag}`, cause))
            )
        )
      ).pipe(
        Effect.forkScoped
      )
      return hub
    })
  )

  /** The Hub, fed by the home link, with its heartbeat. */
  static readonly layer = Layer.effectDiscard(
    Effect.flatMap(Effect.service(Hub), (hub) =>
      hub.beat.pipe(
        Effect.catchCause((cause) => Effect.logError("heartbeat failed", cause)),
        Effect.repeat(Schedule.spaced(heartbeat)),
        Effect.forkScoped
      ))
  ).pipe(Layer.provideMerge(Hub.layerFed))
}
