import { Clock, Context, Effect, Layer, Ref } from "effect"
import { type EngineState, emptyState, onEvent, onTick, type Push } from "./DownloadEngine.ts"
import type { MediaEvent } from "./Events.ts"

/** The engine's live state, with time read from `Clock` so tests can drive it with `TestClock`. */
export class DownloadActivities extends Context.Service<DownloadActivities, {
  /** Applies an event and returns the pushes it calls for. */
  readonly handle: (event: MediaEvent) => Effect.Effect<ReadonlyArray<Push>>
  /** Periodic housekeeping: throttled progress, stalled downloads, expired activities. */
  readonly tick: Effect.Effect<ReadonlyArray<Push>>
  readonly snapshot: Effect.Effect<EngineState>
}>()("quai/DownloadActivities") {
  static readonly layer = Layer.effect(
    DownloadActivities,
    Effect.gen(function*() {
      const ref = yield* Ref.make<EngineState>(emptyState)
      const run = (f: (state: EngineState, now: number) => { state: EngineState; pushes: ReadonlyArray<Push> }) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.modify(ref, (state) => {
            const step = f(state, now)
            return [step.pushes, step.state] as const
          }))
      return {
        handle: (event) => run((state, now) => onEvent(state, event, now)),
        tick: run(onTick),
        snapshot: Ref.get(ref)
      }
    })
  )
}
