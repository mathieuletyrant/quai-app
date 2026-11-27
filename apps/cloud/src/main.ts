import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { HomeLinks, HomeRoute } from "./home/HomeLinks.ts"
import { Homes, HomesRoute } from "./home/Homes.ts"
import { PublicAccessLive } from "./PublicAccess.ts"
import { ApnsLive } from "./push/ApnsClient.ts"

// All configuration comes from environment variables. Nothing about a home is kept or computed
// here: Quai Home runs Quai, the Cloud relays the app to it and sends its pushes.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

/**
 * What every home shares: the APNs key, the public access, the server's facts, and the links, which
 * tell each home the first two and send its pushes.
 */
const Shared = HomeLinks.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ApnsLive, PublicAccessLive, ServerInfo.layer))
)

// Quai Home's WebSocket, and every other request relayed to the home it is for.
HttpRouter.serve(Layer.mergeAll(HomeRoute, HomesRoute)).pipe(
  Layer.provide(Homes.layer),
  Layer.provide(Shared),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
