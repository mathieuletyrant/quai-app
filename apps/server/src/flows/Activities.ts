import { Clock, Context, Effect, Layer, Ref, Semaphore } from "effect"
import { StateStore } from "../store/StateStore.ts"
import type { Activity, EngineState, Push, Result } from "./Engine.ts"
import { emptyState, onEvent, onTick } from "./Engine.ts"
import type { FlowEvent } from "./Events.ts"
import { FlowStore } from "./FlowStore.ts"

const stateKey = "flow-activities"

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

/**
 * The engine's live state, with time from `Clock` (so tests drive it with `TestClock`) and the
 * flows from the store. Saved after every change, read back on start.
 */
export class Activities extends Context.Service<Activities, {
  readonly handle: (event: FlowEvent) => Effect.Effect<ReadonlyArray<Push>>
  readonly tick: Effect.Effect<ReadonlyArray<Push>>
  readonly snapshot: Effect.Effect<EngineState>
}>()("quai/Activities") {
  static readonly layerPersisted = Layer.effect(
    Activities,
    Effect.gen(function*() {
      const store = yield* StateStore
      const flowStore = yield* FlowStore
      const ref = yield* Ref.make<EngineState>(fromStored(yield* store.load(stateKey)))
      const lock = yield* Semaphore.make(1)
      const run = (f: (state: EngineState, flows: Parameters<typeof onTick>[1], now: number) => Result) =>
        Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const flows = yield* flowStore.all
          const before = yield* Ref.get(ref)
          const result = f(before, flows, now)
          yield* Ref.set(ref, result.state)
          if (result.state !== before) yield* store.save(stateKey, [...result.state.activities.values()])
          return result.pushes
        }))
      return {
        handle: (event) => run((state, flows, now) => onEvent(state, flows, event, now)),
        tick: run(onTick),
        snapshot: Ref.get(ref)
      }
    })
  )

  /** In memory only (tests). */
  static readonly layer = Activities.layerPersisted.pipe(Layer.provide(StateStore.memory))
}
