import {
  type ActionType,
  type AlertSettings,
  type Flow,
  type HomeProtocol,
  type IntegrationSource,
  InvalidAction
} from "@quai/api"
import { Context, Effect, Option, Schema } from "effect"
import type { AlertState } from "../alerts/Alerts.ts"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"
import type { CallRequest } from "../home/HomeLink.ts"
import type { HomeReads, Read } from "../home/HomeReads.ts"

/** What an integration sees to decide what to watch, and to read what comes back. */
export interface WatchContext {
  readonly flows: ReadonlyArray<Flow>
  /** Activities still running (not ended). */
  readonly running: ReadonlyArray<Activity>
  /** The services the connected Quai Home reaches. */
  readonly services: ReadonlyArray<HomeProtocol.HomeService>
  /** Now, epoch milliseconds (from `Clock`). */
  readonly now: number
  /** The home's time zone (IANA): see `HomeTime`. */
  readonly timeZone: string
  /** Which alerts are on, and their thresholds. */
  readonly alerts: AlertSettings
  /** The linked Home's protocol version; absent: the current one. */
  readonly protocol?: number
}

/** What a reading means: catalog events for the flows, or the state of an alert. */
export type Signal = FlowEvent | AlertState

export const isAlertState = (signal: Signal): signal is AlertState => "_tag" in signal && signal._tag === "AlertState"

/** What Quai Home read for one watch, sent because it changed (or is the first read). */
export interface Snapshot {
  readonly watch: HomeProtocol.Watch
  readonly status: number
  readonly body: string
}

/**
 * A service that doesn't push (or not everything): Quai Home polls it on the LAN, only while a
 * flow needs it, and sends what it read when it changes. The meaning of it is read here.
 */
export interface Watcher<S extends Signal = FlowEvent> {
  /**
   * The watches needed now. Ids are unique across integrations (prefix them with the service) and
   * stable while the watch is the same: the Hub sends a new list only when it changes.
   */
  readonly watches: (context: WatchContext) => ReadonlyArray<HomeProtocol.Watch>
  /** A snapshot of one of its watches, as catalog events. Logs and skips what it can't read. */
  readonly read: (snapshot: Snapshot, context: WatchContext) => Effect.Effect<ReadonlyArray<S>>
  /** Quai Home couldn't read one of its watches (unreachable, refused). Once per failure streak. */
  readonly failed?: (
    watch: HomeProtocol.Watch,
    reason: string,
    context: WatchContext
  ) => Effect.Effect<ReadonlyArray<S>>
  /** Every heartbeat while the home is connected: for what only time changes (health's 5 minutes). */
  readonly tick?: (context: WatchContext) => Effect.Effect<ReadonlyArray<S>>
}

/** A service that pushes: its payloads, forwarded by Quai Home, read as catalog events. */
export interface Webhook {
  readonly read: (body: unknown) => Effect.Effect<ReadonlyArray<FlowEvent>, Schema.SchemaError>
}

/** Runs a Live Activity button for the activity it was pressed on. */
export type ActionHandler = (activity: Activity) => Effect.Effect<void, InvalidAction>

/**
 * A button's call to `service` (its name as shown) through Quai Home: anything but a 2xx answer,
 * Quai Home offline included, is an InvalidAction in words (`Seerr: HTTP 500`).
 */
export const actionCall = (
  reads: HomeReads["Service"],
  service: string,
  call: CallRequest
): Effect.Effect<void, InvalidAction> =>
  reads.write(call, (message) => new InvalidAction({ message: `${service}: ${message}` })).pipe(
    Effect.catchTag(
      "HomeOffline",
      (error) => Effect.fail(new InvalidAction({ message: `${service}: ${error.message}` }))
    ),
    Effect.asVoid
  )

/**
 * Everything Quai knows about one service, in one place: the catalog events it produces (by
 * webhook or watches) and the actions it runs. Adding a service is adding an integration.
 */
export interface Integration {
  /** Its service (Cleanuparr only feeds the journal), or `quai` for Quai's own checks. */
  readonly service: IntegrationSource
  readonly webhook?: Webhook
  readonly watcher?: Watcher
  /** Readings that say whether an alert is going on (alerts/Alerts.ts), rather than flow events. */
  readonly alertWatcher?: Watcher<AlertState>
  readonly actions: Partial<Record<ActionType, ActionHandler>>
}

/** Every integration of the running Cloud. */
export class Integrations extends Context.Service<Integrations, ReadonlyArray<Integration>>()("quai/Integrations") {}

/** Running activities that pass `test`, in their flow. */
export const runningWhere = (
  context: Pick<WatchContext, "flows" | "running">,
  test: (activity: Activity, flow: Flow) => boolean
): ReadonlyArray<Activity> =>
  context.running.filter((activity) => {
    const flow = context.flows.find((candidate) => candidate.id === activity.flowId)
    return flow !== undefined && test(activity, flow)
  })

export const anyEnabledFlow = (context: Pick<WatchContext, "flows">, subject: Flow["subject"]) =>
  context.flows.some((flow) => flow.enabled && flow.subject === subject)

/** Reads a JSON body against a schema; `None` when it doesn't fit. */
export const readJson = <A, I>(schema: Schema.Codec<A, I>, body: string) =>
  Schema.decodeUnknownOption(Schema.fromJsonString(schema))(body)

/** A read watched: Quai Home polls the same GET the Cloud reads once, so both are defined once. */
export const watchOf = (id: string, read: Read<unknown>, everySeconds: number): HomeProtocol.Watch => ({
  id,
  service: read.service,
  path: read.path,
  everySeconds
})

/**
 * A snapshot of a watched read, decoded as the read is: None, logged with its service and path
 * (never what it answered), when the service answered other than 200 or with what Quai can't read.
 */
export const readSnapshot = <A>(read: Read<A>, snapshot: Snapshot): Effect.Effect<Option.Option<A>> => {
  const value = snapshot.status === 200 ? readJson(read.schema, snapshot.body) : Option.none<A>()
  if (Option.isSome(value)) return Effect.succeed(value)
  const why = snapshot.status === 200 ? "an answer Quai can't read" : `HTTP ${snapshot.status}`
  return Effect.as(Effect.logWarning(`${snapshot.watch.service} ${snapshot.watch.path.split("?")[0]}: ${why}`), value)
}
