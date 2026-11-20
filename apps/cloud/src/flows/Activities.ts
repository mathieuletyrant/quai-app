import { Clock, Context, Effect, Layer, Option, Semaphore } from "effect"
import { HomeDocuments } from "../home/HomeLink.ts"
import type { Activity, EngineState, Push, Result } from "./Engine.ts"
import { emptyState, onEvent, onTick } from "./Engine.ts"
import type { FlowEvent } from "./Events.ts"
import { FlowStore } from "./FlowStore.ts"

/** `state/activities`: the running activities, an array of the engine's `Activity`. */
export const activitiesKey = "state/activities"

const fromStored = (value: unknown): EngineState => {
  if (!Array.isArray(value)) return emptyState
  const activities = new Map<string, Activity>()
  for (const item of value as ReadonlyArray<Activity>) {
    if (typeof item?.key === "string" && typeof item?.flowId === "string" && typeof item?.stepIndex === "number") {
      activities.set(item.key, item)
    }
  }
  return { activities }
}

type Send = (pushes: ReadonlyArray<Push>) => Effect.Effect<void>

const keep: Send = () => Effect.void

/**
 * The engine's live state, with time from `Clock` (so tests drive it with `TestClock`) and the
 * flows from the store. It is a home document: read from the home's documents, written back after
 * every change. While no home is connected there is nothing to run: no activity, no push.
 */
export class Activities extends Context.Service<Activities, {
  /**
   * `send` runs before the next change can be computed, so pushes leave in the order the engine
   * made them, whichever fiber made them (the Hub's events and its heartbeat).
   */
  readonly handle: (event: FlowEvent, send?: Send) => Effect.Effect<ReadonlyArray<Push>>
  readonly tick: (send?: Send) => Effect.Effect<ReadonlyArray<Push>>
  readonly snapshot: Effect.Effect<EngineState>
}>()("quai/Activities") {
  static readonly layer = Layer.effect(
    Activities,
    Effect.gen(function*() {
      const store = yield* HomeDocuments
      const flowStore = yield* FlowStore
      const lock = yield* Semaphore.make(1)
      const load = Effect.map(store.get(activitiesKey), (stored) => fromStored(Option.getOrUndefined(stored)))
      const run = (f: (state: EngineState, flows: Parameters<typeof onTick>[1], now: number) => Result, send: Send) =>
        Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const flows = yield* flowStore.all
          const before = yield* load
          const result = f(before, flows, now)
          const after = [...result.state.activities.values()]
          if (result.state !== before && JSON.stringify(after) !== JSON.stringify([...before.activities.values()])) {
            yield* store.put(activitiesKey, after)
          }
          yield* send(result.pushes)
          return result.pushes
        })).pipe(
          Effect.catchTags({
            HomeError: (error) => Effect.as(Effect.logDebug(`activities not run: ${error.message}`), []),
            HomeOffline: (error) => Effect.as(Effect.logDebug(`activities not run: ${error.message}`), [])
          })
        )
      return {
        handle: (event, send = keep) => run((state, flows, now) => onEvent(state, flows, event, now), send),
        tick: (send = keep) => run(onTick, send),
        snapshot: Effect.orElseSucceed(load, () => emptyState)
      }
    })
  )
}
