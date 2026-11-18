import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { createServer } from "node:http"
import { ApiLive } from "./Api.ts"
import { DownloadActivities } from "./engine/DownloadActivities.ts"
import { Watcher } from "./engine/Watcher.ts"
import { WebhooksLive } from "./http/Webhooks.ts"
import { Apns } from "./push/Apns.ts"
import { Notifier } from "./push/Notifier.ts"
import { Jellyfin } from "./stack/Jellyfin.ts"
import { QBittorrent } from "./stack/QBittorrent.ts"
import { WebhookSetupLive } from "./stack/Setup.ts"
import { StackConfig } from "./stack/StackConfig.ts"
import * as Database from "./store/Database.ts"
import { Devices } from "./store/Devices.ts"
import { Settings } from "./store/Settings.ts"
import { ServerInfo } from "./Version.ts"

// All configuration comes from environment variables: the image knows nothing about its host.
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

const Stack = Layer.mergeAll(QBittorrent.layer, Jellyfin.layer).pipe(
  Layer.provideMerge(StackConfig.layer),
  Layer.provide(NodeHttpClient.layerUndici)
)

const Store = Layer.mergeAll(Devices.layer, Settings.layer).pipe(Layer.provideMerge(Database.layer))

const Engine = Watcher.layer.pipe(
  Layer.provideMerge(Notifier.layer),
  Layer.provideMerge(DownloadActivities.layer),
  Layer.provide(Apns.layer),
  Layer.provideMerge(Stack),
  Layer.provideMerge(Store)
)

const App = Layer.mergeAll(
  HttpRouter.serve(Layer.mergeAll(ApiLive, WebhooksLive, ConsoleLive)),
  WebhookSetupLive.pipe(Layer.provide(NodeHttpClient.layerUndici))
)

App.pipe(
  Layer.provide(Engine),
  Layer.provide(ServerInfo.layer),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
