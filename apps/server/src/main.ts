import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { createServer } from "node:http"
import { ApiLive } from "./Api.ts"
import { ServerInfo } from "./Version.ts"

// Toute la configuration passe par des variables d'environnement : l'image ne connaît pas son hôte.
const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

// La console compilée est servie par le serveur quand QUAI_CONSOLE_DIR est défini (c'est le cas dans l'image).
const ConsoleLive = Layer.unwrap(
  Effect.gen(function*() {
    const root = yield* Config.option(Config.String("QUAI_CONSOLE_DIR"))
    return Option.match(root, {
      onNone: () => Layer.empty,
      onSome: (root) => HttpStaticServer.layer({ root, spa: true })
    })
  })
)

HttpRouter.serve(Layer.mergeAll(ApiLive, ConsoleLive)).pipe(
  Layer.provide(ServerInfo.layer),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
