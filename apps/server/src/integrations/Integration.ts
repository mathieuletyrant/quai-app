import type { ActionType, Flow, InvalidAction, ServiceName } from "@quai/api"
import { Context, type Duration, type Effect, type Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"

/** What a poller sees to decide whether it's needed, and to do its work. */
export interface PollContext {
  readonly flows: ReadonlyArray<Flow>
  /** Activities still running (not ended). */
  readonly running: ReadonlyArray<Activity>
}

/** A service that doesn't push (or not everything): Quai asks it, only when a flow needs it. */
export interface Poller {
  readonly name: string
  readonly every: Duration.Input
  readonly needed: (context: PollContext) => boolean
  /** Reports its own failures (logged) and returns the events it found. */
  readonly run: (context: PollContext) => Effect.Effect<ReadonlyArray<FlowEvent>>
}

/** A service that pushes: its payloads, posted to `/webhooks/<service>`, read as catalog events. */
export interface Webhook {
  readonly read: (body: unknown) => Effect.Effect<ReadonlyArray<FlowEvent>, Schema.SchemaError>
}

/** Runs a Live Activity button for the activity it was pressed on. */
export type ActionHandler = (activity: Activity) => Effect.Effect<void, InvalidAction>

/**
 * Everything Quai knows about one service, in one place: the catalog events it produces (by
 * webhook or polling) and the actions it runs. Adding a service is adding an integration.
 */
export interface Integration {
  readonly service: ServiceName
  readonly webhook?: Webhook
  readonly pollers: ReadonlyArray<Poller>
  readonly actions: Partial<Record<ActionType, ActionHandler>>
}

/** Every integration of the running server. */
export class Integrations extends Context.Service<Integrations, ReadonlyArray<Integration>>()("quai/Integrations") {}

/** Running activities whose current step shows `show`, in their flow. */
export const runningWhere = (
  context: PollContext,
  test: (activity: Activity, flow: Flow) => boolean
): ReadonlyArray<Activity> =>
  context.running.filter((a) => {
    const flow = context.flows.find((f) => f.id === a.flowId)
    return flow !== undefined && test(a, flow)
  })

export const anyEnabledFlow = (context: PollContext, subject: Flow["subject"]) =>
  context.flows.some((f) => f.enabled && f.subject === subject)
