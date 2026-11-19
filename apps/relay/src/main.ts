import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Socket } from "effect/socket"
import { createServer } from "node:http"
import { WebhookSetupLive } from "./ArrWebhooks.ts"
import { AgentConfig } from "./Config.ts"
import { Link } from "./Link.ts"
import { Proxy } from "./Proxy.ts"
import { ServiceAuth } from "./ServiceAuth.ts"
import { WebhooksLive } from "./Webhooks.ts"

// All configuration comes from environment variables: the image knows nothing about its host.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const { port } = yield* AgentConfig
    return NodeHttpServer.layer(createServer, { port })
  })
)

const SocketLive = Layer.unwrap(
  Effect.gen(function*() {
    const { cloudUrl } = yield* AgentConfig
    return Socket.layerWebSocket(cloudUrl, { openTimeout: "10 seconds" })
  })
).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))

const Services = Proxy.layer.pipe(
  Layer.provideMerge(ServiceAuth.layer),
  Layer.provide(NodeHttpClient.layerUndici)
)

const App = Layer.mergeAll(HttpRouter.serve(WebhooksLive), WebhookSetupLive).pipe(
  Layer.provide(HttpLive),
  Layer.provideMerge(Link.layer),
  Layer.provide(SocketLive),
  Layer.provideMerge(Services),
  Layer.provideMerge(AgentConfig.layer)
)

App.pipe(Layer.launch, NodeRuntime.runMain)
