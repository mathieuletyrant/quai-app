import type { DeviceId, HomeOffline } from "@quai/api"
import { Clock, Context, Duration, Effect, Layer, Option } from "effect"
import { Notifier } from "../push/Notifier.ts"
import { FlowStore } from "./FlowStore.ts"
import { testScript } from "./TestScript.ts"

/**
 * Plays a flow's test script in the background, on the chosen iPhones. The request that asks for
 * it returns at once; the pushes follow over about half a minute.
 */
export class TestRunner extends Context.Service<TestRunner, {
  /** `None` when the flow doesn't exist. */
  readonly play: (flowId: string, deviceIds: ReadonlyArray<DeviceId>) => Effect.Effect<Option.Option<void>, HomeOffline>
}>()("quai/TestRunner") {
  static readonly layer = Layer.effect(
    TestRunner,
    Effect.gen(function*() {
      const flows = yield* FlowStore
      const notifier = yield* Notifier
      return {
        play: (flowId, deviceIds) =>
          Effect.gen(function*() {
            const flow = yield* flows.get(flowId)
            if (Option.isNone(flow)) return Option.none()
            const now = yield* Clock.currentTimeMillis
            yield* Effect.forEach(testScript(flow.value, now, `${now}`), (beat) =>
              Effect.andThen(
                Effect.sleep(Duration.millis(beat.afterMs)),
                Effect.forEach(deviceIds, (id) => notifier.sendTo(id, [beat.push]), { discard: true })
              ), { discard: true }).pipe(Effect.forkDetach)
            return Option.some(undefined)
          })
      }
    })
  )
}
