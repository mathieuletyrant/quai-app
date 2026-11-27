import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { HomeApp } from "@quai/domain/App.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { HomeLinks, HomeRoute } from "./home/HomeLinks.ts"
import { Homes, HomesRoute } from "./home/Homes.ts"
import { PublicAccessLive } from "./PublicAccess.ts"
import { ApnsLive } from "./push/ApnsClient.ts"

// All configuration comes from environment variables. Nothing about a home is kept here: it
// comes from Quai Home when it connects, and every change goes back to it.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

/** What every home shares: the links, the APNs key, the public access, the server's facts. */
const Shared = Layer.mergeAll(HomeLinks.layer, ApnsLive, PublicAccessLive, ServerInfo.layer)

// Quai Home's WebSocket, and every other request to the app of the home it is for.
HttpRouter.serve(Layer.mergeAll(HomeRoute, HomesRoute)).pipe(
  Layer.provide(Homes.layer(HomeApp)),
  Layer.provide(Shared),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
