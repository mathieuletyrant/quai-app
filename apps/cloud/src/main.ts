import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { ApiLive } from "./Api.ts"
import { Alerts } from "./alerts/Alerts.ts"
import { ActionRunner } from "./flows/ActionRunner.ts"
import { Fixes } from "./fixes/Fixes.ts"
import { Activities } from "./flows/Activities.ts"
import { FlowStore } from "./flows/FlowStore.ts"
import { TestRunner } from "./flows/TestRunner.ts"
import { ConsoleOnlyThroughHome, ConsoleRelayLive } from "./home/ConsoleRelay.ts"
import { Devices } from "./home/Devices.ts"
import { HomeLink, HomeRoute } from "./home/HomeLink.ts"
import { HomeReads } from "./home/HomeReads.ts"
import { IntegrationsLive } from "./integrations/All.ts"
import { Hub } from "./integrations/Hub.ts"
import { Journal } from "./journal/Journal.ts"
import { Library } from "./library/Library.ts"
import { Apns } from "./push/Apns.ts"
import { Notifier } from "./push/Notifier.ts"
import { PublicAccess } from "./PublicAccess.ts"
import { HomeTime } from "./releases/HomeTime.ts"
import { Releases } from "./releases/Releases.ts"
import { Requests } from "./requests/Requests.ts"
import { ServerInfo } from "./Version.ts"

// All configuration comes from environment variables. Nothing about a home is kept here: it
// comes from Quai Home when it connects, and every change goes back to it.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

const Home = Layer.mergeAll(Devices.layer, FlowStore.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(HomeLink.documents, HomeReads.layer)),
  Layer.provideMerge(Journal.layer),
  Layer.provideMerge(HomeLink.layer)
)

const Engine = Layer.mergeAll(ActionRunner.layer, Requests.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(Hub.layer, TestRunner.layer, Library.layer, Fixes.layer, Releases.layer)),
  Layer.provideMerge(Layer.mergeAll(Notifier.layer, Alerts.layer)),
  Layer.provideMerge(Activities.layer),
  Layer.provideMerge(Layer.mergeAll(Apns.layer, PublicAccess.layer, IntegrationsLive, HomeTime.layer)),
  Layer.provideMerge(Home)
)

// The console is Quai Home's: it relays its requests over the link, and /console-api answers only those.
HttpRouter.serve(Layer.mergeAll(ApiLive, HomeRoute, ConsoleRelayLive, ConsoleOnlyThroughHome)).pipe(
  Layer.provide(Engine),
  Layer.provide(ServerInfo.layer),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
