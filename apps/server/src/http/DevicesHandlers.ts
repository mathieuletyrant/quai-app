import { CurrentDevice, InvalidPairingCode, QuaiApi } from "@quai/api"
import { Duration, Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { DownloadActivities } from "../engine/DownloadActivities.ts"
import { Notifier } from "../push/Notifier.ts"
import { testScript } from "../push/TestActivity.ts"
import { Devices } from "../store/Devices.ts"

export const DevicesHandlers = HttpApiBuilder.group(QuaiApi, "devices", (handlers) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    const activities = yield* DownloadActivities
    const notifier = yield* Notifier
    return handlers
      .handle("pair", ({ payload }) =>
        Effect.flatMap(devices.pair(payload), Option.match({
          onNone: () => Effect.fail(new InvalidPairingCode({ message: "This code is unknown, used or expired." })),
          onSome: Effect.succeed
        })))
      .handle("update", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          yield* devices.update(device.id, payload)
        }))
      .handle("activityToken", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          yield* devices.setActivityToken(device.id, payload.mediaKey, payload.pushToken)
        }))
      .handle("preferences", () =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          return yield* devices.preferences(device.id)
        }))
      .handle("savePreferences", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          return yield* devices.setPreferences(device.id, payload)
        }))
      .handle("testActivity", () =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          const mediaKey = `test:${device.id}:${Date.now()}`
          // Plays in the background: the request returns at once, the pushes follow over ~45 s.
          yield* Effect.forEach(testScript(mediaKey), (beat) =>
            Effect.andThen(Effect.sleep(Duration.millis(beat.afterMs)), notifier.sendTo(device.id, [beat.push])), {
            discard: true
          }).pipe(Effect.forkDetach)
        }))
      .handle("activities", () =>
        Effect.map(activities.snapshot, (state) =>
          [...state.activities.values()].map((a) => ({ attributes: a.attributes, content: a.content }))))
  }))
