import { QuaiApi } from "@quai/api"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ConsoleHandlers } from "./http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "./http/DeviceAuth.ts"
import { DevicesHandlers } from "./http/DevicesHandlers.ts"
import { PushHandlers } from "./http/PushHandlers.ts"
import { SystemHandlers } from "./http/SystemHandlers.ts"

/** Every route of the contract, with its handlers. Needs the stores and the engine. */
export const ApiLive = HttpApiBuilder.layer(QuaiApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, DevicesHandlers, ConsoleHandlers, PushHandlers]),
  Layer.provide(DeviceAuthLive)
)
