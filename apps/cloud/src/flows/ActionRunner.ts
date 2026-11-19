import { type ActionType, actionCatalog, type HomeOffline, InvalidAction } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpApiError } from "effect/http-api"
import { Hub } from "../integrations/Hub.ts"
import { Integrations } from "../integrations/Integration.ts"
import { Activities } from "./Activities.ts"
import { FlowStore } from "./FlowStore.ts"

/**
 * Runs a button pressed on a Live Activity: checks the activity's current step offers it, hands
 * it to the service's integration, then has Quai Home read that service again so the new state
 * reaches the iPhone in a second.
 */
export class ActionRunner extends Context.Service<ActionRunner, {
  readonly run: (key: string, action: ActionType) => Effect.Effect<void, InvalidAction | HttpApiError.NotFound | HomeOffline>
}>()("quai/ActionRunner") {
  static readonly layer = Layer.effect(
    ActionRunner,
    Effect.gen(function*() {
      const activities = yield* Activities
      const flows = yield* FlowStore
      const integrations = yield* Integrations
      const hub = yield* Hub
      return {
        run: (key, action) =>
          Effect.gen(function*() {
            const activity = (yield* activities.snapshot).activities.get(key)
            if (activity === undefined || activity.endedAt !== null) return yield* Effect.fail(new HttpApiError.NotFound())
            const flow = (yield* flows.all).find((f) => f.id === activity.flowId)
            if (!(flow?.steps[activity.stepIndex]?.actions ?? []).includes(action)) {
              return yield* Effect.fail(new InvalidAction({ message: "This activity doesn't offer that button now." }))
            }
            const service = actionCatalog.find((a) => a.type === action)!.service
            const handler = integrations.find((i) => i.service === service)?.actions[action]
            if (handler === undefined) return yield* Effect.fail(new InvalidAction({ message: `${service} can't do that.` }))
            yield* handler(activity)
            yield* hub.refresh(service)
          })
      }
    })
  )
}
