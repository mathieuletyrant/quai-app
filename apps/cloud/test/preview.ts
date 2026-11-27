import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { HomeRoutes } from "@quai/domain/App.ts"
import { torrentsWatchId } from "@quai/domain/integrations/qbittorrent.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { PublicAccessLive } from "../src/PublicAccess.ts"
import { makeApns } from "../src/push/ApnsClient.ts"
import { makeFakeHome, recordedHome, testLink } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { dayMs, downloading, previewRoutes, recordedDay, storageHistory } from "./previewHome.ts"

/**
 * Quai, as Quai Home runs it, on a real port, on the tests' fake Quai Home answering from the
 * recorded fixtures: what the iPhone app (or the console) shows of a home, without a stack. Run
 * with `pnpm --filter @quai/cloud preview`; pair from `POST /console-api/pairing-codes`.
 */

const FakeHomeLinked = Layer.effectDiscard(
  Effect.gen(function*() {
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    const days = Math.floor((now - recordedDay) / dayMs)
    const home = yield* makeFakeHome({
      services: ["radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "reclaimerr", "cleanuparr"],
      webUrls: {
        radarr: ["http://umbrel.local:7878", "https://radarr.example.com"],
        sonarr: ["http://umbrel.local:8989"]
      },
      answer: recordedHome(previewRoutes(days))
    })
    for (const [key, value] of storageHistory(now)) home.documents.set(key, value)
    yield* home.connect
    yield* downloading(home)
    // The fake Quai Home keeps answering the snapshot of the torrent: Quai Home polls it every few seconds.
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.andThen(
          Effect.sleep("5 seconds"),
          home.snapshot(torrentsWatchId, (fixture("demo/qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
        )
      )
    )
    yield* Effect.logInfo("Preview: Quai on a fake Quai Home. Pair with POST /console-api/pairing-codes.")
  })
)

const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

// The home's routes, on the fake Quai Home in memory, with no APNs key. The console's routes answer
// on the public port here: the preview has no Quai Home in front of them.
const Shared = testLink.pipe(
  Layer.provideMerge(Layer.mergeAll(Layer.effect(Apns, makeApns(null)), PublicAccessLive))
)

HttpRouter.serve(Layer.mergeAll(HomeRoutes, FakeHomeLinked)).pipe(
  Layer.provide(Shared),
  Layer.provide(Layer.succeed(ServerInfo, { version: "preview", startedAt: Date.now() })),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
