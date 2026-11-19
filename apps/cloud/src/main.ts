import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { createServer } from "node:http"
import { ApiLive } from "./Api.ts"
import { ActionRunner } from "./flows/ActionRunner.ts"
import { Activities } from "./flows/Activities.ts"
import { FlowStore } from "./flows/FlowStore.ts"
import { TestRunner } from "./flows/TestRunner.ts"
import { Devices } from "./home/Devices.ts"
import { HomeLink, HomeRoute } from "./home/HomeLink.ts"
import { IntegrationsLive } from "./integrations/All.ts"
import { Hub } from "./integrations/Hub.ts"
import { Library } from "./library/Library.ts"
import { Apns } from "./push/Apns.ts"
import { Notifier } from "./push/Notifier.ts"
import { ServerInfo } from "./Version.ts"

// All configuration comes from environment variables. Nothing about a home is kept here: it
// comes from Quai Home when it connects, and every change goes back to it.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

// The built console is served when QUAI_CONSOLE_DIR is set (it is in the image).
const ConsoleLive = Layer.unwrap(
  Effect.gen(function*() {
    const root = yield* Config.option(Config.String("QUAI_CONSOLE_DIR"))
    return Option.match(root, {
      onNone: () => Layer.empty,
      onSome: (root) => HttpStaticServer.layer({ root, spa: true })
    })
  })
)

const Home = Layer.mergeAll(Devices.layer, FlowStore.layer).pipe(
  Layer.provideMerge(HomeLink.documents),
  Layer.provideMerge(HomeLink.layer)
)

const Engine = ActionRunner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Hub.layer, TestRunner.layer, Library.layer)),
  Layer.provideMerge(Notifier.layer),
  Layer.provideMerge(Activities.layer),
  Layer.provideMerge(Layer.mergeAll(Apns.layer, IntegrationsLive)),
  Layer.provideMerge(Home)
)

HttpRouter.serve(Layer.mergeAll(ApiLive, HomeRoute, ConsoleLive)).pipe(
  Layer.provide(Engine),
  Layer.provide(ServerInfo.layer),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
