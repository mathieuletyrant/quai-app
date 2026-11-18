import type { DeviceId } from "@quai/api"
import { Clock, Context, Effect, Layer } from "effect"
import type { Push } from "../flows/Engine.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { deliveryFor } from "../flows/Targeting.ts"
import { Devices, type PushTarget } from "../store/Devices.ts"
import { Apns } from "./Apns.ts"
import { apnsBody } from "./ApnsPayload.ts"

/** Sends the engine's pushes to the paired iPhones, each according to its own preferences. */
export class Notifier extends Context.Service<Notifier, {
  readonly send: (pushes: ReadonlyArray<Push>) => Effect.Effect<void>
  /** Sends to one iPhone only, or every iPhone with `null` (test buttons). */
  readonly sendTo: (deviceId: DeviceId | null, pushes: ReadonlyArray<Push>) => Effect.Effect<void>
}>()("quai/Notifier") {
  static readonly layer = Layer.effect(
    Notifier,
    Effect.gen(function*() {
      const apns = yield* Apns
      const devices = yield* Devices
      const flowStore = yield* FlowStore
      // Which iPhones show which activity. A reported activity token also counts, which covers
      // activities started before a restart.
      const shown = new Set<string>()
      const key = (deviceId: string, activityKey: string) => `${deviceId}\u0000${activityKey}`

      const one = (push: Push, only: DeviceId | null) =>
        Effect.gen(function*() {
          if (!(yield* apns.configured)) return
          const flow = (yield* flowStore.all).find((f) => f.id === push.activity.flowId)
          if (flow === undefined) return
          const activityKey = push.activity.key
          const now = yield* Clock.currentTimeMillis
          const targets = (yield* devices.targets(activityKey)).filter((t) => only === null || t.deviceId === only)
          yield* Effect.forEach(targets, (target: PushTarget) =>
            Effect.gen(function*() {
              const k = key(target.deviceId, activityKey)
              const delivery = deliveryFor(push, flow, {
                preferences: target.preferences,
                pushToStartToken: target.pushToStartToken,
                activityToken: target.activityToken,
                shown: shown.has(k) || target.activityToken !== null,
                dismissed: target.dismissed
              }, now)
              // The activity is over: nothing left to show again.
              if (push._tag === "End" && target.dismissed !== null) yield* devices.clearDismissed(target.deviceId, activityKey)
              if (delivery._tag === "None") return
              if (delivery._tag === "Start") shown.add(k)
              if (delivery._tag === "Start" && target.dismissed !== null) yield* devices.clearDismissed(target.deviceId, activityKey)
              if (delivery._tag === "End") shown.delete(k)
              const step = flow.steps[push.activity.stepIndex]?.id ?? "?"
              const progress = delivery.content.progress === undefined ? "" : ` ${Math.round(delivery.content.progress * 100)} %`
              yield* apns.send({
                environment: target.apnsEnvironment,
                deviceToken: delivery.token,
                body: apnsBody(delivery, now),
                // High priority: low priority let iOS hold updates back until the app opened.
                priority: 10
              }).pipe(
                Effect.tap(() => Effect.logInfo(`push ${delivery._tag} ${activityKey} ${step}${progress} → ${target.deviceId}`)),
                Effect.catchTag("ApnsError", (error) =>
                  Effect.gen(function*() {
                    yield* Effect.logWarning(`APNs refused a ${delivery._tag} for ${target.deviceId}: ${error.reason}`)
                    if (error.tokenGone) yield* devices.dropToken(delivery.token)
                  }))
              )
            }), { concurrency: 4, discard: true })
        })

      return {
        send: (pushes) => Effect.forEach(pushes, (p) => one(p, null), { discard: true }),
        sendTo: (deviceId, pushes) => Effect.forEach(pushes, (p) => one(p, deviceId), { discard: true })
      }
    })
  )
}
