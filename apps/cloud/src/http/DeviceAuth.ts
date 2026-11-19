import { CurrentDevice, DeviceAuth } from "@quai/api"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpApiError } from "effect/http-api"
import { Devices } from "../home/Devices.ts"

/** Checks the iPhone's token against the paired iPhones of the home (a hash, never the token). */
export const DeviceAuthLive = Layer.effect(
  DeviceAuth,
  Effect.gen(function*() {
    const devices = yield* Devices
    return {
      bearer: (httpEffect, { credential }) =>
        Effect.gen(function*() {
          const device = yield* devices.authenticate(Redacted.value(credential))
          if (Option.isNone(device)) return yield* Effect.fail(new HttpApiError.Unauthorized())
          return yield* Effect.provideService(httpEffect, CurrentDevice, { id: device.value.id, name: device.value.name })
        })
    }
  })
)
