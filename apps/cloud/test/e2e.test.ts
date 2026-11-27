import { describe, expect, it } from "@effect/vitest"
import { Activities } from "@quai/domain/flows/Activities.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import { Hub } from "@quai/domain/integrations/Hub.ts"
import { watchIds } from "@quai/domain/integrations/jellyfin.ts"
import { torrentsWatchId } from "@quai/domain/integrations/qbittorrent.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { Effect, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { generateKeyPairSync } from "node:crypto"
import { makeApns } from "../src/push/ApnsClient.ts"
import { cloudLive, makeFakeHome } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { fakeApns } from "./push/fakeApns.ts"

const keyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString()

describe("end to end", () => {
  it.effect("a movie added in Radarr reaches \"ready\" on the iPhone, all of it through Quai Home", () =>
    Effect.gen(function*() {
      const apnsServer = yield* fakeApns
      const apns = yield* makeApns(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: apnsServer.url, production: apnsServer.url }
      )

      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome({ services: ["radarr", "qbittorrent", "jellyfin"] })
        yield* home.connect
        const devices = yield* Devices
        const { code } = yield* devices.createPairingCode
        const paired = yield* devices.pair({
          code,
          name: "iPhone",
          apnsEnvironment: "development",
          pushToStartToken: "pts"
        })
        const deviceId = paired._tag === "Some" ? paired.value.deviceId : yield* Effect.die("no pairing")
        const hub = yield* Hub
        const steps = () => apnsServer.hits.map((hit) => `${hit.body.aps.event}:${hit.body.aps["content-state"].step}`)
        const radarr = (name: string) => home.webhook("radarr", fixture(`radarr/${name}.json`))

        // Something Quai can't read changes nothing.
        yield* home.webhook("radarr", { nope: true })
        expect(apnsServer.hits).toHaveLength(0)

        yield* radarr("movie-added")
        expect(steps()).toEqual(["start:0"])
        // The iPhone started the activity and reports its token.
        yield* devices.setActivityToken(deviceId, "download|movie:tmdb:693134", "act")

        yield* TestClock.adjust("3 minutes")
        yield* radarr("grab")
        expect(steps()).toEqual(["start:0", "update:1"])
        // Quai Home now polls the torrent; its snapshot is the progress.
        expect(home.watch(torrentsWatchId)).toBeDefined()
        yield* TestClock.adjust("15 seconds")
        yield* home.snapshot(torrentsWatchId, (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
        expect(steps()).toEqual(["start:0", "update:1", "update:1"])
        expect(apnsServer.hits[2]!.body.aps["content-state"]).toMatchObject({ progress: 0.4199, remainingSeconds: 683 })

        yield* TestClock.adjust("10 minutes")
        yield* radarr("download")
        expect(steps().at(-1)).toBe("update:2")
        expect(home.watch(torrentsWatchId)).toBeUndefined()

        // Waiting for Jellyfin: Quai Home reads its users, then its latest titles as the
        // administrator; not there yet, then there.
        yield* home.snapshot(watchIds.users, fixture("jellyfin/users.json"))
        const find = watchIds.find("movie:tmdb:693134")
        expect(home.watch(find)?.path).toContain("SortBy=DateCreated")
        yield* home.snapshot(find, { Items: [] })
        expect(steps().at(-1)).toBe("update:2")
        yield* TestClock.adjust("15 seconds")
        yield* home.snapshot(find, fixture("jellyfin/items-movie.json"))
        expect(steps().at(-1)).toBe("end:3")
        expect(apnsServer.hits.every((hit, index) => hit.path === (index === 0 ? "/3/device/pts" : "/3/device/act")))
          .toBe(true)
        expect(home.watch(find)).toBeUndefined()

        yield* TestClock.adjust("15 minutes")
        yield* hub.beat
        expect((yield* (yield* Activities).snapshot).activities.size).toBe(0)
        expect(home.documents.get("state/activities")).toEqual([])
      }).pipe(Effect.provide(cloudLive.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }).pipe(Effect.scoped))
})
