import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Activities } from "../src/flows/Activities.ts"
import { FlowStore } from "../src/flows/FlowStore.ts"
import { FlowsHandlers } from "../src/http/FlowsHandlers.ts"
import { ConsoleHandlers } from "../src/http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "../src/http/DeviceAuth.ts"
import { DevicesHandlers } from "../src/http/DevicesHandlers.ts"
import { PushHandlers } from "../src/http/PushHandlers.ts"
import { Apns } from "../src/push/Apns.ts"
import { Notifier } from "../src/push/Notifier.ts"
import { PushKey } from "../src/store/PushKey.ts"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SystemHandlers } from "../src/http/SystemHandlers.ts"
import * as Database from "../src/store/Database.ts"
import { Devices } from "../src/store/Devices.ts"
import { ServerInfo } from "../src/Version.ts"

/** Everything the routes need, on an in-memory database and an in-memory HTTP server. */
const pushKey = Layer.effect(PushKey, Effect.suspend(() => PushKey.make(join(mkdtempSync(join(tmpdir(), "quai-")), "secret.key"))))

export const TestApp = Layer.mergeAll(SystemHandlers, DevicesHandlers, ConsoleHandlers, PushHandlers, FlowsHandlers).pipe(
  Layer.provideMerge(DeviceAuthLive),
  Layer.provideMerge(Notifier.layer),
  Layer.provideMerge(Layer.mergeAll(Devices.layer, Activities.layer, pushKey)),
  Layer.provideMerge(FlowStore.layer),
  Layer.provideMerge(Apns.layer),
  Layer.provideMerge(Database.layerFile(":memory:")),
  Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
  Layer.provideMerge(NodeHttpServer.layerTest)
)
