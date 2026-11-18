import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { TestClock } from "effect/testing"
import { generateKeyPairSync } from "node:crypto"
import { Activities } from "../src/flows/Activities.ts"
import { IntegrationsLive } from "../src/integrations/All.ts"
import { Hub } from "../src/integrations/Hub.ts"
import { fixedFlows } from "./flows/helpers.ts"
import { WebhooksLive } from "../src/http/Webhooks.ts"
import { Apns } from "../src/push/Apns.ts"
import { Notifier } from "../src/push/Notifier.ts"
import { Jellyfin } from "../src/stack/Jellyfin.ts"
import { QBittorrent } from "../src/stack/QBittorrent.ts"
import { StackConfig } from "../src/stack/StackConfig.ts"
import * as Database from "../src/store/Database.ts"
import { Devices } from "../src/store/Devices.ts"
import { Settings } from "../src/store/Settings.ts"
import { StateStore } from "../src/store/StateStore.ts"
import { fakeHttp } from "./fakeHttp.ts"
import { fixture } from "./fixtures.ts"
import { fakeApns } from "./push/fakeApns.ts"

const keyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString()

const stackConfig = Layer.succeed(StackConfig, {
  radarr: null,
  sonarr: null,
  qbittorrent: { url: "http://qbittorrent:8080", username: null, password: null },
  jellyfin: { url: "http://jellyfin:8096", apiKey: Redacted.make("k") },
  internalUrl: null
})

/** The stack as the scenario goes: the torrent at 42 %, and Dune in Jellyfin once imported. */
let jellyfinHasDune = false
const stack = fakeHttp((r) => {
  if (r.url.host === "qbittorrent:8080") return { json: (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1) }
  if (r.url.pathname === "/Items") return { json: jellyfinHasDune ? fixture("jellyfin/items-movie.json") : { Items: [] } }
  return { status: 404 }
})

describe("end to end", () => {
  it.effect("a movie added in Radarr reaches \"ready\" on the iPhone without touching anything", () =>
    Effect.gen(function*() {
      const apnsServer = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: apnsServer.url, production: apnsServer.url }
      )

      yield* Effect.gen(function*() {
        const devices = yield* Devices
        const { code } = yield* devices.createPairingCode
        const paired = yield* devices.pair({ code, name: "iPhone", apnsEnvironment: "development", pushToStartToken: "pts" })
        const deviceId = paired._tag === "Some" ? paired.value.deviceId : yield* Effect.die("no pairing")

        const { webhookToken } = yield* Settings
        const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
        const post = (name: string, token = webhookToken) =>
          client.execute(HttpClientRequest.post(`/webhooks/radarr?token=${token}`).pipe(
            HttpClientRequest.bodyJsonUnsafe(fixture(`radarr/${name}.json`))
          ))
        const hub = yield* Hub
        const steps = () => apnsServer.hits.map((h) => `${h.body.aps.event}:${h.body.aps["content-state"].step}`)

        // A wrong token is refused and changes nothing.
        expect(yield* Effect.flip(post("movie-added", "nope"))).toBeDefined()
        expect(apnsServer.hits).toHaveLength(0)

        yield* post("movie-added")
        expect(steps()).toEqual(["start:0"])
        // The iPhone started the activity and reports its token.
        yield* devices.setActivityToken(deviceId, "download|movie:tmdb:693134", "act")

        yield* TestClock.adjust("3 minutes")
        yield* post("grab")
        yield* TestClock.adjust("15 seconds")
        yield* hub.beat
        expect(steps()).toEqual(["start:0", "update:1", "update:1"])
        expect(apnsServer.hits[2]!.body.aps["content-state"]).toMatchObject({ progress: 0.4199, remainingSeconds: 683 })

        yield* TestClock.adjust("10 minutes")
        yield* post("download")
        yield* TestClock.adjust("15 seconds")
        yield* hub.beat
        expect(steps().at(-1)).toBe("update:2")

        jellyfinHasDune = true
        yield* TestClock.adjust("15 seconds")
        yield* hub.beat
        expect(steps().at(-1)).toBe("end:3")
        expect(apnsServer.hits.every((h, i) => h.path === (i === 0 ? "/3/device/pts" : "/3/device/act"))).toBe(true)

        yield* TestClock.adjust("15 minutes")
        yield* hub.beat
        expect((yield* (yield* Activities).snapshot).activities.size).toBe(0)
      }).pipe(Effect.provide(
        HttpRouter.serve(WebhooksLive, { disableLogger: true }).pipe(
          Layer.provideMerge(Layer.effect(Hub, Hub.make)),
          Layer.provideMerge(Notifier.layer),
          Layer.provideMerge(Activities.layer),
          Layer.provide(Layer.succeed(Apns, apns)),
          Layer.provide(IntegrationsLive.pipe(
            Layer.provideMerge(Layer.mergeAll(QBittorrent.layer, Jellyfin.layer)),
            Layer.provideMerge(stackConfig),
            Layer.provideMerge(stack)
          )),
          Layer.provideMerge(fixedFlows()),
          Layer.provideMerge(Layer.mergeAll(Devices.layer, Settings.layer, StateStore.layer)),
          Layer.provideMerge(Database.layerFile(":memory:")),
          Layer.provideMerge(NodeHttpServer.layerTest)
        )
      ))
    }).pipe(Effect.scoped))
})
