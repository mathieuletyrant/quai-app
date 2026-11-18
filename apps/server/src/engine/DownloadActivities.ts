import { Clock, Context, Effect, Layer, Ref, Semaphore } from "effect"
import { StateStore } from "../store/StateStore.ts"
import { type Activity, type EngineState, emptyState, onEvent, onTick, type Push } from "./DownloadEngine.ts"
import type { MediaEvent } from "./Events.ts"

const stateKey = "download-activities"

/** The state as stored: a plain array, read back leniently (a bad document means starting empty). */
const toStored = (state: EngineState) => [...state.activities.values()]
const fromStored = (value: unknown): EngineState => {
  if (!Array.isArray(value)) return emptyState
  const activities = new Map<string, Activity>()
  for (const item of value as ReadonlyArray<Activity>) {
    if (typeof item?.attributes?.mediaKey === "string" && typeof item?.content?.step === "string") {
      activities.set(item.attributes.mediaKey, item)
    }
  }
  return { activities }
}

/**
 * The engine's live state, with time read from `Clock` so tests can drive it with `TestClock`.
 * Saved after every change and read back on start, so a restart doesn't orphan running activities.
 */
export class DownloadActivities extends Context.Service<DownloadActivities, {
  /** Applies an event and returns the pushes it calls for. */
  readonly handle: (event: MediaEvent) => Effect.Effect<ReadonlyArray<Push>>
  /** Periodic housekeeping: throttled progress, stalled downloads, expired activities. */
  readonly tick: Effect.Effect<ReadonlyArray<Push>>
  readonly snapshot: Effect.Effect<EngineState>
}>()("quai/DownloadActivities") {
  static readonly layerPersisted = Layer.effect(
    DownloadActivities,
    Effect.gen(function*() {
      const store = yield* StateStore
      const ref = yield* Ref.make<EngineState>(fromStored(yield* store.load(stateKey)))
      const lock = yield* Semaphore.make(1)
      const run = (f: (state: EngineState, now: number) => { state: EngineState; pushes: ReadonlyArray<Push> }) =>
        Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const before = yield* Ref.get(ref)
          const step = f(before, now)
          yield* Ref.set(ref, step.state)
          if (step.state !== before) yield* store.save(stateKey, toStored(step.state))
          return step.pushes
        }))
      return {
        handle: (event) => run((state, now) => onEvent(state, event, now)),
        tick: run(onTick),
        snapshot: Ref.get(ref)
      }
    })
  )

  /** In memory only (tests). */
  static readonly layer = DownloadActivities.layerPersisted.pipe(Layer.provide(StateStore.memory))
}
