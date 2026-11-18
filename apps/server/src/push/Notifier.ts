import { Clock, Context, Effect, Layer } from "effect"
import type { Push } from "../engine/DownloadEngine.ts"
import { Devices, type Recipient } from "../store/Devices.ts"
import { Apns } from "./Apns.ts"
import { apnsBody, apnsPriority } from "./ApnsPayload.ts"

/** Sends the engine's pushes to every paired iPhone that should get them. */
export class Notifier extends Context.Service<Notifier, {
  readonly send: (pushes: ReadonlyArray<Push>) => Effect.Effect<void>
}>()("quai/Notifier") {
  static readonly layer = Layer.effect(
    Notifier,
    Effect.gen(function*() {
      const apns = yield* Apns
      const devices = yield* Devices
      const lastStep = new Map<string, string>()

      const deliver = (push: Push, recipients: ReadonlyArray<Recipient>, priority: 5 | 10) =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const body = apnsBody(push, now)
          yield* Effect.forEach(recipients, (recipient) =>
            apns.send({ environment: recipient.apnsEnvironment, deviceToken: recipient.token, body, priority }).pipe(
              Effect.catchTag("ApnsError", (error) =>
                Effect.gen(function*() {
                  yield* Effect.logWarning(`APNs refused a ${push._tag} for ${recipient.deviceId}: ${error.reason}`)
                  if (error.tokenGone) yield* devices.dropToken(recipient.token)
                }))
            ), { concurrency: 4, discard: true })
        })

      const one = (push: Push) =>
        Effect.gen(function*() {
          if (!apns.configured) return
          const mediaKey = push._tag === "Start" ? push.attributes.mediaKey : push.mediaKey
          const priority = apnsPriority(push, lastStep.get(mediaKey) ?? null)
          if (push._tag === "End") lastStep.delete(mediaKey)
          else lastStep.set(mediaKey, push.content.step)
          const recipients = push._tag === "Start"
            ? yield* devices.startRecipients
            : yield* devices.activityRecipients(mediaKey)
          yield* deliver(push, recipients, priority)
        })

      return { send: (pushes) => Effect.forEach(pushes, one, { discard: true }) }
    })
  )
}
