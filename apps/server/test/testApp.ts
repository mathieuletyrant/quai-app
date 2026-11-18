import { NodeHttpServer } from "@effect/platform-node"
import { Layer } from "effect"
import { DownloadActivities } from "../src/engine/DownloadActivities.ts"
import { ConsoleHandlers } from "../src/http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "../src/http/DeviceAuth.ts"
import { DevicesHandlers } from "../src/http/DevicesHandlers.ts"
import { SystemHandlers } from "../src/http/SystemHandlers.ts"
import * as Database from "../src/store/Database.ts"
import { Devices } from "../src/store/Devices.ts"
import { ServerInfo } from "../src/Version.ts"

/** Everything the routes need, on an in-memory database and an in-memory HTTP server. */
export const TestApp = Layer.mergeAll(SystemHandlers, DevicesHandlers, ConsoleHandlers).pipe(
  Layer.provideMerge(DeviceAuthLive),
  Layer.provideMerge(Layer.mergeAll(Devices.layer, DownloadActivities.layer)),
  Layer.provideMerge(Database.layerFile(":memory:")),
  Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
  Layer.provideMerge(NodeHttpServer.layerTest)
)
