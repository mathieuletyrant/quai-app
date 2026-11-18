import { CurrentDevice, InvalidPairingCode, QuaiApi } from "@quai/api"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { DownloadActivities } from "../engine/DownloadActivities.ts"
import { Devices } from "../store/Devices.ts"

export const DevicesHandlers = HttpApiBuilder.group(QuaiApi, "devices", (handlers) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    const activities = yield* DownloadActivities
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
      .handle("activities", () =>
        Effect.map(activities.snapshot, (state) =>
          [...state.activities.values()].map((a) => ({ attributes: a.attributes, content: a.content }))))
  }))
