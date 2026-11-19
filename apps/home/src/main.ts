import { NodeFileSystem, NodeHttpClient, NodeHttpServer, NodeRuntime, NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Socket } from "effect/socket"
import { createServer } from "node:http"
import { WebhookSetupLive } from "./ArrWebhooks.ts"
import { Calls } from "./Calls.ts"
import { RelayConfig } from "./Config.ts"
import { HomeKey } from "./HomeKey.ts"
import { HomeStore } from "./HomeStore.ts"
import { Link } from "./Link.ts"
import { ServiceAuth } from "./ServiceAuth.ts"
import { Watches } from "./Watches.ts"
import { WebhooksLive } from "./Webhooks.ts"

// All configuration comes from environment variables: the image knows nothing about its host.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const { port } = yield* RelayConfig
    return NodeHttpServer.layer(createServer, { port })
  })
)

const SocketLive = Layer.unwrap(
  Effect.gen(function*() {
    const { coreUrl } = yield* RelayConfig
    return Socket.layerWebSocket(coreUrl, { openTimeout: "10 seconds" })
  })
).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))

const Services = Watches.layer.pipe(
  Layer.provideMerge(Calls.layer),
  Layer.provideMerge(ServiceAuth.layer),
  Layer.provide(NodeHttpClient.layerUndici)
)

const Home = Layer.mergeAll(HomeKey.layer, HomeStore.layer).pipe(Layer.provide(NodeFileSystem.layer))

const App = Layer.mergeAll(HttpRouter.serve(WebhooksLive), WebhookSetupLive).pipe(
  Layer.provide(HttpLive),
  Layer.provideMerge(Link.layer),
  Layer.provide(SocketLive),
  Layer.provideMerge(Layer.mergeAll(Services, Home)),
  Layer.provideMerge(RelayConfig.layer)
)

App.pipe(Layer.launch, NodeRuntime.runMain)
