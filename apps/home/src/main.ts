import { NodeFileSystem, NodeHttpClient, NodeHttpServer, NodeRuntime, NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Socket } from "effect/socket"
import { createServer } from "node:http"
import { WebhookSetupLive } from "./ArrWebhooks.ts"
import { Calls } from "./Calls.ts"
import { CloudSeen } from "./CloudSeen.ts"
import { HomeConfig } from "./Config.ts"
import { ConsoleAuth } from "./ConsoleAuth.ts"
import { ConsoleFilesLive, ConsoleRelayLive, HomeApiLive } from "./ConsoleServer.ts"
import { HomeKey } from "./HomeKey.ts"
import { HomeStore } from "./HomeStore.ts"
import { Journal } from "./Journal.ts"
import { Link } from "./Link.ts"
import { ServiceAuth } from "./ServiceAuth.ts"
import { ServiceSettings } from "./ServiceSettings.ts"
import { Watches } from "./Watches.ts"
import { WebhooksLive } from "./Webhooks.ts"

// All configuration comes from environment variables and /data: the image knows nothing about its host.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const { port } = yield* HomeConfig
    return NodeHttpServer.layer(createServer, { port })
  })
)

// The link to Quai Cloud, when QUAI_CLOUD_URL is set; without it, Quai Home runs on its own and
// its console says what to set.
const LinkLive = Layer.unwrap(
  Effect.gen(function*() {
    const { cloudUrl } = yield* HomeConfig
    if (cloudUrl === null) {
      yield* Effect.logWarning("QUAI_CLOUD_URL not set: Quai Home runs without a Quai Cloud")
      return Link.unlinked
    }
    return Link.layer.pipe(
      Layer.provide(Socket.layerWebSocket(cloudUrl, { openTimeout: "10 seconds" })),
      Layer.provide(NodeSocket.layerWebSocketConstructor)
    )
  })
)

const Home = Layer.mergeAll(HomeKey.layer, HomeStore.layer, Journal.layer, ServiceSettings.layer, CloudSeen.layer).pipe(
  Layer.provide(NodeFileSystem.layer)
)

const Services = Watches.layer.pipe(
  Layer.provideMerge(Calls.layer),
  Layer.provideMerge(ServiceAuth.layer),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provideMerge(ConsoleAuth.layer),
  Layer.provideMerge(Home)
)

const App = Layer.mergeAll(
  HttpRouter.serve(Layer.mergeAll(WebhooksLive, HomeApiLive, ConsoleRelayLive, ConsoleFilesLive)),
  WebhookSetupLive
).pipe(
  Layer.provide(HttpLive),
  Layer.provideMerge(LinkLive),
  Layer.provideMerge(Services),
  Layer.provideMerge(HomeConfig.layer)
)

App.pipe(Layer.launch, NodeRuntime.runMain)
