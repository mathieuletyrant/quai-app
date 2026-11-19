import type { ActionType, Flow, HomeProtocol, InvalidAction, ServiceName } from "@quai/api"
import { Context, type Effect, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"

/** What an integration sees to decide what to watch, and to read what comes back. */
export interface WatchContext {
  readonly flows: ReadonlyArray<Flow>
  /** Activities still running (not ended). */
  readonly running: ReadonlyArray<Activity>
  /** The services the connected Quai Home reaches. */
  readonly services: ReadonlyArray<HomeProtocol.HomeService>
}

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
export interface Watcher {
  /**
   * The watches needed now. Ids are unique across integrations (prefix them with the service) and
   * stable while the watch is the same: the Hub sends a new list only when it changes.
   */
  readonly watches: (context: WatchContext) => ReadonlyArray<HomeProtocol.Watch>
  /** A snapshot of one of its watches, as catalog events. Logs and skips what it can't read. */
  readonly read: (snapshot: Snapshot, context: WatchContext) => Effect.Effect<ReadonlyArray<FlowEvent>>
  /** Quai Home couldn't read one of its watches (unreachable, refused). Once per failure streak. */
  readonly failed?: (watch: HomeProtocol.Watch, reason: string, context: WatchContext) => Effect.Effect<ReadonlyArray<FlowEvent>>
  /** Every heartbeat while the home is connected: for what only time changes (health's 5 minutes). */
  readonly tick?: (context: WatchContext) => Effect.Effect<ReadonlyArray<FlowEvent>>
}

/** A service that pushes: its payloads, forwarded by Quai Home, read as catalog events. */
export interface Webhook {
  readonly read: (body: unknown) => Effect.Effect<ReadonlyArray<FlowEvent>, Schema.SchemaError>
}

/** Runs a Live Activity button for the activity it was pressed on. */
export type ActionHandler = (activity: Activity) => Effect.Effect<void, InvalidAction>

/**
 * Everything Quai knows about one service, in one place: the catalog events it produces (by
 * webhook or watches) and the actions it runs. Adding a service is adding an integration.
 */
export interface Integration {
  readonly service: ServiceName
  readonly webhook?: Webhook
  readonly watcher?: Watcher
  readonly actions: Partial<Record<ActionType, ActionHandler>>
}

/** Every integration of the running Cloud. */
export class Integrations extends Context.Service<Integrations, ReadonlyArray<Integration>>()("quai/Integrations") {}

/** Running activities that pass `test`, in their flow. */
export const runningWhere = (
  context: Pick<WatchContext, "flows" | "running">,
  test: (activity: Activity, flow: Flow) => boolean
): ReadonlyArray<Activity> =>
  context.running.filter((a) => {
    const flow = context.flows.find((f) => f.id === a.flowId)
    return flow !== undefined && test(a, flow)
  })

export const anyEnabledFlow = (context: Pick<WatchContext, "flows">, subject: Flow["subject"]) =>
  context.flows.some((f) => f.enabled && f.subject === subject)

/** Reads a JSON body against a schema; `None` when it doesn't fit. */
export const readJson = <A, I>(schema: Schema.Codec<A, I>, body: string) =>
  Schema.decodeUnknownOption(Schema.fromJsonString(schema))(body)
