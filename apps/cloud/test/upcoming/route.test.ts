import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi, type UpcomingItem } from "@quai/api"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { makeFakeHome, recordedHome, type Recording } from "../fakeHome.ts"
import { TestApp, testAppDroppingOn } from "../testApp.ts"

const paris = "Europe/Paris"

const realHome: Readonly<Record<string, Recording>> = {
  "radarr GET /api/v3/calendar": "real/radarr/calendar.json",
  "sonarr GET /api/v3/calendar": "real/sonarr/calendar.json",
  "radarr GET /api/v3/movie": "real/radarr/movies.json",
  "sonarr GET /api/v3/series": "real/sonarr/series.json",
  "radarr GET /api/v3/history/since": "real/radarr/history-since.json",
  "sonarr GET /api/v3/history/since": "real/sonarr/history-since.json",
  "radarr GET /api/v3/config/mediamanagement": "radarr/mediamanagement.json",
  "sonarr GET /api/v3/config/mediamanagement": "radarr/mediamanagement.json",
  "reclaimerr GET /api/v1/candidates": "real/reclaimerr/candidates.json",
  "cleanuparr GET /api/strikes": "real/cleanuparr/strikes.json",
  "cleanuparr GET /api/configuration/queue_cleaner": "real/cleanuparr/queue-cleaner.json",
  "cleanuparr GET /api/queue-rules/stall": "real/cleanuparr/stall-rules.json",
  "cleanuparr GET /api/queue-rules/slow": "real/cleanuparr/slow-rules.json",
  "cleanuparr GET /api/jobs/QueueCleaner": "real/cleanuparr/job-queue-cleaner.json",
  "cleanuparr GET /api/configuration/download_cleaner": "cleanuparr/download-cleaner.json",
  "cleanuparr GET /api/jobs/DownloadCleaner": "cleanuparr/job-download-cleaner.json",
  "qbittorrent GET /api/v2/torrents/info": "real/qbittorrent/torrents-info.json",
  "radarr GET /api/v3/queue": { json: { records: [] } },
  "sonarr GET /api/v3/queue": { json: { records: [] } }
}
const everything = ["radarr", "sonarr", "reclaimerr", "cleanuparr", "qbittorrent"] as const

/** An iPhone paired in Paris, and the Upcoming route as it calls it. */
const pairedApi = Effect.gen(function*() {
  const console = yield* HttpApiTest.groups(QuaiApi, ["console"])
  const qr = yield* console.console.createPairingCode({ payload: { serverUrls: [] } })
  const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
    payload: { name: "iPhone", apnsEnvironment: "development", code: qr.code, timeZone: paris }
  })
  return yield* HttpApiTest.groups(QuaiApi, ["upcoming"]).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(
        DeviceAuth,
        ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))
      )
    )
  )
})

const kinds = (items: ReadonlyArray<UpcomingItem>) =>
  items.map((item) => `${item.kind} ${item.title}${item.episode === undefined ? "" : ` ${item.episode}`}`)

describe("upcoming route", () => {
  const now = Date.parse("2026-11-24T21:00:00Z")

  it.effect("lists what comes and what goes from a real home, by date, with the space that comes back", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: [...everything], answer: recordedHome(realHome) })
      yield* home.connect
      const api = yield* pairedApi
      const upcoming = yield* api.upcoming.list()
      expect(upcoming.timeZone).toBe(paris)
      expect(upcoming.unavailable).toEqual([])
      expect(upcoming.homeOutdated).toBe(false)
      expect(kinds(upcoming.items)).toEqual([
        "releaseDay Warrior Kid",
        "releaseDay The Lord of the Rings: The Rings of Power S03E07–E08",
        "plannedDeletion Vampire Diaries S06",
        "plannedDeletion Chainsaw Man – Le Film : L'arc de Reze",
        "plannedDeletion Runner",
        "seedCleanup 2 torrents"
      ])
      const seed = upcoming.items.find((item) => item.kind === "seedCleanup")!
      // Our House is still in the library; Phony's series isn't listed in Sonarr, which doesn't
      // mean its files are gone: neither seed is said to free anything.
      expect(seed.count).toBe(2)
      expect(seed.freesBytes).toBeUndefined()
      expect(seed.at).toBe(Math.floor((now + (2160 * 3600 - 41034) * 1000) / 1000))
      const deletion = upcoming.items.find((item) => item.kind === "plannedDeletion" && item.title === "Runner")!
      expect(deletion.fixId).toBe("deletion-9")
      expect(deletion.at).toBe(Date.parse("2026-11-30T10:00:05Z") / 1000)
    }).pipe(Effect.provide(TestApp)))

  it.effect("an older Quai Home gets no seed cleanup and no space, and is asked nothing it would refuse", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: [...everything], answer: recordedHome(realHome), protocol: 8 })
      yield* home.connect
      const upcoming = yield* (yield* pairedApi).upcoming.list()
      expect(upcoming.homeOutdated).toBe(true)
      expect(upcoming.items.filter((item) => item.kind === "seedCleanup")).toEqual([])
      expect(upcoming.items.filter((item) => item.freesBytes !== undefined)).toEqual([])
      expect(upcoming.items.some((item) => item.kind === "plannedDeletion")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service that didn't answer is unavailable, the rest still shows", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({
        services: [...everything],
        answer: recordedHome(realHome, {
          "qbittorrent GET /api/v2/torrents/info": { status: 500 },
          "reclaimerr GET /api/v1/candidates": { status: 500 }
        })
      })
      yield* home.connect
      const upcoming = yield* (yield* pairedApi).upcoming.list()
      expect(upcoming.unavailable).toEqual(["reclaimerr", "qbittorrent"])
      expect(upcoming.items.some((item) => item.kind === "releaseDay")).toBe(true)
      expect(upcoming.items.filter((item) => item.kind === "seedCleanup" || item.kind === "plannedDeletion")).toEqual(
        []
      )
      expect(upcoming.items.filter((item) => item.freesBytes !== undefined)).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service Quai Home doesn't reach is never mentioned", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: ["radarr"], answer: recordedHome(realHome) })
      yield* home.connect
      const upcoming = yield* (yield* pairedApi).upcoming.list()
      expect(upcoming.unavailable).toEqual([])
      expect(upcoming.items.map((item) => item.kind)).toEqual(["releaseDay"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("Quai Home dropping while reading is 503 HomeOffline", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["radarr", "sonarr"], answer: recordedHome(realHome) })
      yield* home.connect
      expect((yield* Effect.flip((yield* pairedApi).upcoming.list()))._tag).toBe("HomeOffline")
    }).pipe(Effect.provide(testAppDroppingOn("radarr GET /api/v3/calendar"))))
})
