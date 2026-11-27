import { describe, expect, it } from "@effect/vitest"
import { Activities } from "@quai/domain/flows/Activities.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import { watchIds } from "@quai/domain/integrations/jellyfin.ts"
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

const series = { id: 233, title: "Our House (2022)", tvdbId: 407046, tmdbId: 157014, imdbId: "tt10098728", year: 2022 }
const episode = (episodeNumber: number) => ({
  id: 9000 + episodeNumber,
  seasonNumber: 1,
  episodeNumber,
  title: `Episode ${episodeNumber}`
})
const downloadId = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
const subjectKey = "series:tvdb:407046:dl:abcdef0123456789abcdef0123456789abcdef01"

// Recorded from a real Jellyfin 12.4 (users anonymized): it names the series in the library's
// language, "Notre maison", and leaves it out of its list without a user.
const jellyfin = (name: string) => fixture(`jellyfin/${name}.json`)

describe("end to end, a series", () => {
  it.effect("a season pack blocked, imported one episode at a time, named otherwise in Jellyfin, reaches \"ready\"", () =>
    Effect.gen(function*() {
      const apnsServer = yield* fakeApns
      const apns = yield* makeApns(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: apnsServer.url, production: apnsServer.url }
      )
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome({ services: ["sonarr", "jellyfin"] })
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
        const sonarr = (eventType: string, episodes: ReadonlyArray<number>) =>
          home.webhook("sonarr", { eventType, series, episodes: episodes.map(episode), downloadId })
        const activity = () =>
          Effect.map(
            Effect.flatMap(Activities, (activities) => activities.snapshot),
            (state) => [...state.activities.values()][0]
          )

        yield* sonarr("Grab", [1, 2, 3, 4])
        yield* devices.setActivityToken(deviceId, `download|${subjectKey}`, "act")
        expect((yield* activity())?.title).toBe("Our House (2022) · S01")

        yield* TestClock.adjust("2 minutes")
        yield* sonarr("ManualInteractionRequired", [1, 2, 3, 4])
        expect((yield* activity())?.tone).toBe("stalled")

        yield* TestClock.adjust("2 minutes")
        for (const episodeNumber of [3, 4, 2, 1]) yield* sonarr("Download", [episodeNumber])
        const importing = yield* activity()
        expect(importing).toMatchObject({ title: "Our House (2022) · S01", stepIndex: 2, tone: "active" })

        // Quai Home reads Jellyfin's users first, then its latest series as the administrator.
        expect(home.watch(watchIds.find(subjectKey))?.path).not.toContain("userId")
        yield* home.snapshot(watchIds.users, jellyfin("users"))
        const find = home.watch(watchIds.find(subjectKey))
        expect(find?.path).toContain("userId=5f2b9c1e8a7d4f3b9e6c0a1d2b3c4e5f")
        expect(find?.path).not.toContain("SearchTerm")
        yield* home.snapshot(watchIds.find(subjectKey), jellyfin("latest-series"))
        const episodes = home.watch(watchIds.episodes(subjectKey))
        expect(episodes?.path).toContain("ParentId=1d44f2954a4209050a6e45617780e347")
        yield* home.snapshot(watchIds.episodes(subjectKey), jellyfin("episodes-notre-maison"))

        const last = apnsServer.hits.at(-1)!.body.aps
        expect([last.event, last["content-state"].step]).toEqual(["end", 3])
        expect((yield* activity())?.tone).toBe("done")
      }).pipe(Effect.provide(cloudLive.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }).pipe(Effect.scoped))

  it.effect("an activity left on \"Importing\" by an older Quai Cloud ends once Jellyfin has it, after a restart", () =>
    Effect.gen(function*() {
      const apnsServer = yield* fakeApns
      const apns = yield* makeApns(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: apnsServer.url, production: apnsServer.url }
      )
      yield* Effect.gen(function*() {
        const home = yield* makeFakeHome({ services: ["sonarr", "jellyfin"] })
        // What 0.27.1 left in Quai Home: the first episode imported, its TVDB id only.
        home.documents.set("state/activities", [{
          key: `download|${subjectKey}`,
          flowId: "download",
          subjectKey,
          title: "Our House (2022) · S01E03",
          stepIndex: 2,
          tone: "active",
          values: {},
          downloadId: downloadId.toLowerCase(),
          lookup: {
            _tag: "Episodes",
            tvdbId: 407046,
            title: "Our House (2022)",
            episodes: [{ season: 1, episode: 3 }]
          },
          enteredAt: 0,
          movedAt: 0,
          lastEventAt: 0,
          endedAt: null,
          pushedAt: 0,
          pushedFingerprint: null
        }])
        yield* home.connect
        yield* home.snapshot(watchIds.users, jellyfin("users"))
        expect(home.watch(watchIds.find(subjectKey))).toBeDefined()
        yield* home.snapshot(watchIds.find(subjectKey), jellyfin("latest-series"))
        yield* home.snapshot(watchIds.episodes(subjectKey), jellyfin("episodes-notre-maison"))
        const [activity] = (yield* (yield* Activities).snapshot).activities.values()
        expect(activity?.tone).toBe("done")
      }).pipe(Effect.provide(cloudLive.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }).pipe(Effect.scoped))
})
