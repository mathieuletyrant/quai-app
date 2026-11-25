import { type ActionType, actionCatalog, type HomeOffline, InvalidAction } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpApiError } from "effect/http-api"
import { Hub } from "../integrations/Hub.ts"
import { Integrations } from "../integrations/Integration.ts"
import { sourceOf } from "../journal/describe.ts"
import { Journal } from "../journal/Journal.ts"
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
      const journal = yield* Journal
      return {
        run: (key, action) =>
          Effect.gen(function*() {
            const activity = (yield* activities.snapshot).activities.get(key)
            if (activity === undefined || activity.endedAt !== null) return yield* Effect.fail(new HttpApiError.NotFound())
            const flow = (yield* flows.all).find((candidate) => candidate.id === activity.flowId)
            if (!(flow?.steps[activity.stepIndex]?.actions ?? []).includes(action)) {
              return yield* Effect.fail(new InvalidAction({ message: "This activity doesn't offer that button now." }))
            }
            const { service, label } = actionCatalog.find((entry) => entry.type === action)!
            const handler = integrations.find((integration) => integration.service === service)?.actions[action]
            if (handler === undefined) return yield* Effect.fail(new InvalidAction({ message: `${service} can't do that.` }))
            yield* journal.outcome({
              level: "info",
              source: sourceOf(service),
              kind: `action.${action}`,
              text: `${label} pressed on ${activity.title}`,
              subject: activity.subjectKey,
              title: activity.title,
              flowId: activity.flowId
            }, handler(activity))
            yield* hub.refresh(service)
          })
      }
    })
  )
}
