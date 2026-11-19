import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpApiError } from "effect/http-api"
import { ActionRunner } from "../src/flows/ActionRunner.ts"
import { TestRunner } from "../src/flows/TestRunner.ts"
import { HomeRequiredLive } from "../src/home/HomeLink.ts"
import { ConsoleHandlers } from "../src/http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "../src/http/DeviceAuth.ts"
import { DevicesHandlers } from "../src/http/DevicesHandlers.ts"
import { FlowsHandlers } from "../src/http/FlowsHandlers.ts"
import { LibraryHandlers } from "../src/http/LibraryHandlers.ts"
import { PushHandlers } from "../src/http/PushHandlers.ts"
import { SystemHandlers } from "../src/http/SystemHandlers.ts"
import { Apns } from "../src/push/Apns.ts"
import { Library } from "../src/library/Library.ts"
import { ServerInfo } from "../src/Version.ts"
import { cloudLive, makeFakeHome } from "./fakeHome.ts"

/** Everything the routes need, on a fake Quai Home and an in-memory HTTP server. No APNs key. */
export const TestApp = Layer.mergeAll(SystemHandlers, DevicesHandlers, LibraryHandlers, ConsoleHandlers, PushHandlers, FlowsHandlers).pipe(
  Layer.provideMerge(Layer.mergeAll(DeviceAuthLive, HomeRequiredLive)),
  Layer.provideMerge(Layer.mergeAll(TestRunner.layer, Library.layer)),
  // Actions have their own tests (flows/actions.test.ts); the routes here don't need Jellyfin.
  Layer.provideMerge(Layer.succeed(ActionRunner, { run: () => Effect.fail(new HttpApiError.NotFound()) })),
  Layer.provideMerge(cloudLive),
  Layer.provideMerge(Layer.effect(Apns, Apns.make(null))),
  Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
  Layer.provideMerge(NodeHttpServer.layerTest)
)

/** A fake Quai Home, connected. */
export const connectedHome = Effect.tap(makeFakeHome(), (home) => home.connect)
