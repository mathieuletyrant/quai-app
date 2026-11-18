import type { ServiceName } from "@quai/api"
import { Clock, Context, Duration, Effect, Layer, Schedule } from "effect"
import { Activities } from "../flows/Activities.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { Notifier } from "../push/Notifier.ts"
import { type Integration, Integrations, type PollContext, type Poller } from "./Integration.ts"

/** The base pace: every poller is considered this often, and runs when its own `every` is due. */
export const heartbeat = "15 seconds"

/**
 * Where events meet the engine. Webhooks hand their events here; a heartbeat runs the pollers an
 * enabled flow needs, when they're due, then the engine's housekeeping; actions ask for a refresh.
 */
export class Hub extends Context.Service<Hub, {
  readonly apply: (events: ReadonlyArray<FlowEvent>) => Effect.Effect<void>
  /** One heartbeat: due and needed pollers, then the engine's tick. */
  readonly beat: Effect.Effect<void>
  /** Runs one service's needed pollers now, due or not (after an action). */
  readonly refresh: (service: ServiceName) => Effect.Effect<void>
}>()("quai/Hub") {
  static readonly make = Effect.gen(function*() {
    const engine = yield* Activities
    const notifier = yield* Notifier
    const flows = yield* FlowStore
    const integrations = yield* Integrations
    const lastRun = new Map<Poller, number>()

    const apply = (events: ReadonlyArray<FlowEvent>) =>
      Effect.forEach(events, (event) => Effect.flatMap(engine.handle(event), notifier.send), { discard: true })

    const context: Effect.Effect<PollContext> = Effect.gen(function*() {
      const { activities } = yield* engine.snapshot
      return { flows: yield* flows.all, running: [...activities.values()].filter((a) => a.endedAt === null) }
    })

    const runPollers = (pollers: ReadonlyArray<Poller>, force: boolean) =>
      Effect.gen(function*() {
        for (const poller of pollers) {
          const now = yield* Clock.currentTimeMillis
          const due = (lastRun.get(poller) ?? -Infinity) + Duration.toMillis(Duration.fromInputUnsafe(poller.every)) <= now
          const ctx = yield* context
          if ((!force && !due) || !poller.needed(ctx)) continue
          lastRun.set(poller, now)
          yield* Effect.flatMap(poller.run(ctx), apply)
        }
      })

    const all = integrations.flatMap((i: Integration) => i.pollers)
    return {
      apply,
      beat: Effect.andThen(runPollers(all, false), Effect.flatMap(engine.tick, notifier.send)),
      refresh: (service: ServiceName) => runPollers(integrations.filter((i) => i.service === service).flatMap((i) => i.pollers), true)
    }
  })

  static readonly layer = Layer.effect(
    Hub,
    Effect.gen(function*() {
      const hub = yield* Hub.make
      yield* hub.beat.pipe(
        Effect.catchCause((cause) => Effect.logError("heartbeat failed", cause)),
        Effect.repeat(Schedule.spaced(heartbeat)),
        Effect.forkScoped
      )
      return hub
    })
  )
}
