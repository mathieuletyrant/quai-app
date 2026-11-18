import type { DeviceId } from "@quai/api"
import { Clock, Context, Effect, Layer } from "effect"
import type { Push } from "../engine/DownloadEngine.ts"
import { Devices, type PushTarget } from "../store/Devices.ts"
import { Apns } from "./Apns.ts"
import { apnsBody } from "./ApnsPayload.ts"
import { deliveryFor } from "./Targeting.ts"

/**
 * Sends the engine's pushes to the paired iPhones, each according to its own preferences: an
 * iPhone sees only the steps it chose, starts the activity at the first of them, and keeps the
 * end on screen as long as it asked.
 */
export class Notifier extends Context.Service<Notifier, {
  readonly send: (pushes: ReadonlyArray<Push>) => Effect.Effect<void>
  /** Sends to one iPhone only (the app's test button). */
  readonly sendTo: (deviceId: DeviceId, pushes: ReadonlyArray<Push>) => Effect.Effect<void>
}>()("quai/Notifier") {
  static readonly layer = Layer.effect(
    Notifier,
    Effect.gen(function*() {
      const apns = yield* Apns
      const devices = yield* Devices
      // Which iPhones show which activity. A reported activity token also counts, which covers
      // activities started before a restart.
      const shown = new Set<string>()
      const key = (deviceId: string, mediaKey: string) => `${deviceId}\u0000${mediaKey}`

      const one = (push: Push, only: DeviceId | null) =>
        Effect.gen(function*() {
          if (!(yield* apns.configured)) return
          const mediaKey = push._tag === "Start" ? push.attributes.mediaKey : push.mediaKey
          const now = yield* Clock.currentTimeMillis
          const targets = (yield* devices.targets(mediaKey)).filter((t) => only === null || t.deviceId === only)
          yield* Effect.forEach(targets, (target: PushTarget) =>
            Effect.gen(function*() {
              const k = key(target.deviceId, mediaKey)
              const delivery = deliveryFor(push, {
                preferences: target.preferences,
                pushToStartToken: target.pushToStartToken,
                activityToken: target.activityToken,
                shown: shown.has(k) || target.activityToken !== null
              }, now)
              if (delivery._tag === "None") return
              if (delivery._tag === "Start") shown.add(k)
              if (delivery._tag === "End") shown.delete(k)
              const content = delivery.push.content
              const progress = content.progress === undefined ? "" : ` ${Math.round(content.progress * 100)} %`
              yield* apns.send({
                environment: target.apnsEnvironment,
                deviceToken: delivery.token,
                body: apnsBody(delivery.push, now),
                // High priority: low priority let iOS hold updates back until the app opened.
                priority: 10
              }).pipe(
                Effect.tap(() => Effect.logInfo(`push ${delivery._tag} ${mediaKey} ${content.step}${progress} → ${target.deviceId}`)),
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
