import { QuaiApi } from "@quai/api"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HomeRequiredLive } from "./home/HomeLink.ts"
import { ConsoleHandlers } from "./http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "./http/DeviceAuth.ts"
import { DevicesHandlers } from "./http/DevicesHandlers.ts"
import { ConsoleFixesHandlers, FixesHandlers } from "./http/FixesHandlers.ts"
import { FlowsHandlers } from "./http/FlowsHandlers.ts"
import { LibraryHandlers } from "./http/LibraryHandlers.ts"
import { PushHandlers } from "./http/PushHandlers.ts"
import { SystemHandlers } from "./http/SystemHandlers.ts"

/** Every route of the contract, with its handlers. Needs the home link, the stores, the engine, the library and the To fix list. */
export const ApiLive = HttpApiBuilder.layer(QuaiApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, DevicesHandlers, LibraryHandlers, FixesHandlers, ConsoleFixesHandlers, ConsoleHandlers, PushHandlers, FlowsHandlers]),
  Layer.provide([DeviceAuthLive, HomeRequiredLive])
)
