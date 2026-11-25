import { type DayRelease, DeviceAuth, QuaiApi, type UpcomingItem } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { DownloadCleanerSettings, type SeedingTorrent, seedCleanups } from "../src/integrations/cleanuparr.ts"
import { seasonOfRelease } from "../src/integrations/arr.ts"
import { spaceBack, type SpaceBackInput, type TorrentInput } from "../src/upcoming/SpaceBack.ts"
import { episodeRange, grabKey, mondayOf, releaseItems, seedItems } from "../src/upcoming/Upcoming.ts"
import { makeFakeHome, recordedHome, type Recording } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { TestApp, testAppDroppingOn } from "./testApp.ts"

const paris = "Europe/Paris"
const hour = 3600_000
const day = 24 * hour
const settings = () => Schema.decodeUnknownSync(DownloadCleanerSettings)(fixture("cleanuparr/download-cleaner.json"))

const torrent = (overrides: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "a023231bf0630af6d783211374ac3d1ac6a8ef36",
  name: "Our.House.S01.1080p",
  category: "tv-sonarr",
  progress: 1,
  ratio: 0.3,
  seeding_time: 0,
  private: true,
  state: "uploading",
  ...overrides
})

describe("upcoming releases", () => {
  it("says a run of episodes as one range", () => {
    expect(episodeRange(["S01E08", "S01E07"])).toBe("S01E07–E08")
    expect(episodeRange(["S01E07"])).toBe("S01E07")
    expect(episodeRange(["S02E01", "S01E10"])).toBe("S01E10–S02E01")
    expect(episodeRange([])).toBeUndefined()
  })

  it("keeps what has no file yet: a series' episodes airing together are one row, a movie is a day", () => {
    const episode = (id: number, code: string, airsAt: number, status: DayRelease["status"] = "missing"): DayRelease => ({
      id: `episode:${id}`,
      kind: "episode",
      libraryId: "series:5",
      title: "Severance",
      episode: code,
      airsAt,
      status
    })
    const items = releaseItems([
      { day: "2026-11-26", release: episode(1, "S02E08", 1795600000) },
      { day: "2026-11-26", release: episode(2, "S02E07", 1795600000) },
      { day: "2026-11-25", release: episode(3, "S02E06", 1795500000, "available") },
      { day: "2026-11-27", release: { id: "movie:9", kind: "movie", libraryId: "movie:9", title: "Dune", status: "grabbed" } }
    ], paris)
    expect(items).toEqual([
      { id: "release-episode-1", kind: "release", service: "sonarr", title: "Severance", episode: "S02E07–E08", at: 1795600000, timed: true, earliest: false },
      { id: "release-movie-9", kind: "release", service: "radarr", title: "Dune", at: Date.parse("2026-11-26T23:00:00Z") / 1000, timed: false, earliest: false }
    ])
  })
})

describe("seed cleanups", () => {
  const now = Date.parse("2026-11-24T21:00:00Z")
  const run = (torrents: ReadonlyArray<SeedingTorrent>, overrides: { nextRunAt?: number; settings?: typeof DownloadCleanerSettings.Type } = {}) =>
    seedCleanups({ settings: overrides.settings ?? settings(), torrents, nextRunAt: overrides.nextRunAt, now })

  it("takes a private torrent once it seeded 90 days, with its files", () => {
    const [cleanup] = run([torrent({ seeding_time: 7499 })])
    expect(cleanup?.rule.name).toBe("Private: 90 days of seeding")
    expect(cleanup?.at).toBe(now + (2160 * 3600 - 7499) * 1000)
    expect(cleanup?.atOnce).toBe(false)
    expect(cleanup?.freesFiles).toBe(true)
  })

  it("marks what goes at once, and leaves alone what no rule covers, what's ignored or not finished", () => {
    expect(run([torrent({ private: false })])[0]?.atOnce).toBe(true)
    expect(run([torrent({ category: "manual" })])).toEqual([])
    expect(run([torrent({ progress: 0.5 })])).toEqual([])
    expect(run([torrent()], { settings: { ...settings(), ignoredDownloads: ["A023231BF0630AF6D783211374AC3D1AC6A8EF36"] } })).toEqual([])
    expect(run([torrent()], { settings: { ...settings(), enabled: false } })).toEqual([])
    // qBittorrent before 5 doesn't say whether a torrent is private: no rule can be told.
    expect(run([torrent({ private: undefined })])).toEqual([])
  })

  it("goes at the download cleaner's next run once due, and has no date when only a ratio takes it", () => {
    const nextRunAt = now + 2 * hour
    const due = run([torrent({ seeding_time: 2160 * 3600 - 60 })], { nextRunAt })
    expect(due[0]?.at).toBe(nextRunAt)
    const byRatio = settings()
    const ratioOnly = {
      ...byRatio,
      clients: byRatio.clients.map((c) => ({ ...c, seedingRules: c.seedingRules.map((r) => ({ ...r, maxRatio: 2, maxSeedTime: -1 })) }))
    }
    expect(run([torrent({ ratio: 1 })], { settings: ratioOnly })[0]?.at).toBeUndefined()
    expect(run([torrent({ ratio: 2.5 })], { settings: ratioOnly, nextRunAt })[0]?.at).toBe(nextRunAt)
  })

  it("groups them by the home's week, those taken at once left out, the undated last", () => {
    const monday = Date.parse("2026-11-30T09:00:00Z")
    const items = seedItems([
      { torrent: torrent({ hash: "a" }), rule: settings().clients[0]!.seedingRules[1]!, at: monday, earliest: false, atOnce: false, freesFiles: true },
      { torrent: torrent({ hash: "b" }), rule: settings().clients[0]!.seedingRules[1]!, at: monday + 3 * day, earliest: false, atOnce: false, freesFiles: true },
      { torrent: torrent({ hash: "c" }), rule: settings().clients[0]!.seedingRules[0]!, at: monday, earliest: false, atOnce: true, freesFiles: true },
      { torrent: torrent({ hash: "d" }), rule: settings().clients[0]!.seedingRules[1]!, at: undefined, earliest: false, atOnce: false, freesFiles: true }
    ], paris, new Map([["b", 3_000_000_000]]))
    expect(items).toEqual([
      {
        id: "seed-2026-11-30",
        kind: "seedCleanup",
        service: "cleanuparr",
        title: "2 torrents",
        at: monday / 1000,
        until: (monday + 3 * day) / 1000,
        timed: false,
        earliest: false,
        count: 2,
        freesBytes: 3_000_000_000
      },
      { id: "seed-ratio", kind: "seedCleanup", service: "cleanuparr", title: "1 torrent", timed: false, earliest: false, count: 1 }
    ])
  })

  it("weeks start on Monday", () => {
    expect(mondayOf("2026-12-03")).toBe("2026-11-30")
    expect(mondayOf("2026-11-30")).toBe("2026-11-30")
    expect(mondayOf("2026-12-06")).toBe("2026-11-30")
  })
})

describe("space back", () => {
  const T1 = Date.parse("2026-11-30T10:00:00Z")
  const T2 = Date.parse("2027-02-12T10:00:00Z")
  const movieTorrent = (overrides: Partial<TorrentInput> = {}): TorrentInput => ({
    hash: "aaa",
    name: "Dune.2021.1080p",
    size: 58e9,
    category: "radarr",
    cleanup: { at: T2, freesFiles: true },
    ...overrides
  })
  const base = (overrides: Partial<SpaceBackInput> = {}): SpaceBackInput => ({
    deletions: [{ candidateId: 9, key: "movie:1", at: T1, sizeBytes: 57e9 }],
    torrents: [movieTorrent()],
    grabs: new Map([["aaa", "movie:1"]]),
    inLibrary: () => true,
    hardlinks: { movie: true, series: true },
    unlinkedCategory: "cleanuparr-unlinked",
    ...overrides
  })

  it("with hardlinks, a deleted title still seeding comes back when its seed goes, on that row", () => {
    const result = spaceBack(base())
    expect([...result.deletions]).toEqual([])
    expect([...result.torrents]).toEqual([["aaa", 58e9]])
  })

  it("comes back on the deletion when the seed went before, or none held it", () => {
    expect([...spaceBack(base({ torrents: [movieTorrent({ cleanup: { at: T1 - day, freesFiles: true } })] })).deletions]).toEqual([[9, 58e9]])
    expect([...spaceBack(base({ torrents: [] })).deletions]).toEqual([[9, 57e9]])
  })

  it("gives nothing while one copy stays: in the library, or a torrent no rule takes", () => {
    const kept = spaceBack(base({ deletions: [] }))
    expect(kept.torrents.size + kept.deletions.size).toBe(0)
    const seeding = spaceBack(base({ torrents: [movieTorrent({ cleanup: undefined })] }))
    expect(seeding.torrents.size + seeding.deletions.size).toBe(0)
    const stopped = spaceBack(base({ torrents: [movieTorrent({ cleanup: { at: T2, freesFiles: false } })] }))
    expect(stopped.torrents.size + stopped.deletions.size).toBe(0)
  })

  it("a seed whose title left the library comes back when it goes", () => {
    expect([...spaceBack(base({ deletions: [], inLibrary: () => false })).torrents]).toEqual([["aaa", 58e9]])
  })

  it("a cross-seed holds the same files: back when the last of the two goes", () => {
    const cross = movieTorrent({ hash: "bbb", category: "cross-seed-link", cleanup: { at: T2 + day, freesFiles: true } })
    expect([...spaceBack(base({ deletions: [], inLibrary: () => false, torrents: [movieTorrent(), cross] })).torrents]).toEqual([["bbb", 58e9]])
    const forever = movieTorrent({ hash: "bbb", category: "cross-seed-link", cleanup: undefined })
    expect(spaceBack(base({ deletions: [], inLibrary: () => false, torrents: [movieTorrent(), forever] })).torrents.size).toBe(0)
  })

  it("copies are each their own space", () => {
    const result = spaceBack(base({ hardlinks: { movie: false, series: true } }))
    expect([...result.deletions]).toEqual([[9, 57e9]])
    expect([...result.torrents]).toEqual([["aaa", 58e9]])
  })

  it("says nothing it can't be sure of: hardlinks unknown, qBittorrent unread", () => {
    const unknown = spaceBack(base({ hardlinks: { movie: undefined, series: undefined } }))
    expect(unknown.torrents.size + unknown.deletions.size).toBe(0)
    const unread = spaceBack(base({ torrents: undefined }))
    expect(unread.torrents.size + unread.deletions.size).toBe(0)
    // A torrent no hardlink holds (Cleanuparr's unlinked category) is its own files, whatever the setting.
    const unlinked = movieTorrent({ hash: "ccc", category: "cleanuparr-unlinked" })
    expect([...spaceBack(base({ deletions: [], torrents: [unlinked], grabs: new Map(), hardlinks: { movie: undefined, series: undefined } })).torrents])
      .toEqual([["ccc", 58e9]])
  })

  it("places a series' grab on its season when the release names one", () => {
    expect(seasonOfRelease("Notre.Maison.2022.S01.INTEGRALE.VFF.1080p")).toBe(1)
    expect(seasonOfRelease("Phony.S01E07.VOSTFR.1080p")).toBe(1)
    expect(seasonOfRelease("Dune.Part.Two.2024.1080p")).toBeUndefined()
    expect(grabKey({ seriesId: 233, sourceTitle: "Notre.Maison.2022.S01.INTEGRALE" })).toBe("series:233:s1")
    expect(grabKey({ movieId: 304 })).toBe("movie:304")
  })
})

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
    Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
  )
})

const kinds = (items: ReadonlyArray<UpcomingItem>) => items.map((i) => `${i.kind} ${i.title}${i.episode === undefined ? "" : ` ${i.episode}`}`)

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
        "release Warrior Kid",
        "release The Lord of the Rings: The Rings of Power S03E07",
        "release The Lord of the Rings: The Rings of Power S03E08",
        "deletion Vampire Diaries S06",
        "deletion Chainsaw Man – Le Film : L'arc de Reze",
        "deletion Runner",
        "seedCleanup 2 torrents"
      ])
      const seed = upcoming.items.find((i) => i.kind === "seedCleanup")!
      // Phony's series is no longer in Sonarr: its seed is its last copy. Our House is still in the library.
      expect(seed.count).toBe(2)
      expect(seed.freesBytes).toBe(1035243237)
      expect(seed.at).toBe(Math.floor((now + (2160 * 3600 - 41034) * 1000) / 1000))
      const deletion = upcoming.items.find((i) => i.kind === "deletion" && i.title === "Runner")!
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
      expect(upcoming.items.filter((i) => i.kind === "seedCleanup")).toEqual([])
      expect(upcoming.items.filter((i) => i.freesBytes !== undefined)).toEqual([])
      expect(upcoming.items.some((i) => i.kind === "deletion")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service that didn't answer is unavailable, the rest still shows", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({
        services: [...everything],
        answer: recordedHome(realHome, { "qbittorrent GET /api/v2/torrents/info": { status: 500 }, "reclaimerr GET /api/v1/candidates": { status: 500 } })
      })
      yield* home.connect
      const upcoming = yield* (yield* pairedApi).upcoming.list()
      expect(upcoming.unavailable).toEqual(["reclaimerr", "qbittorrent"])
      expect(upcoming.items.some((i) => i.kind === "release")).toBe(true)
      expect(upcoming.items.filter((i) => i.kind === "seedCleanup" || i.kind === "deletion")).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service Quai Home doesn't reach is never mentioned", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: ["radarr"], answer: recordedHome(realHome) })
      yield* home.connect
      const upcoming = yield* (yield* pairedApi).upcoming.list()
      expect(upcoming.unavailable).toEqual([])
      expect(upcoming.items.map((i) => i.kind)).toEqual(["release"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("Quai Home dropping while reading is 503 HomeOffline", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["radarr", "sonarr"], answer: recordedHome(realHome) })
      yield* home.connect
      expect((yield* Effect.flip((yield* pairedApi).upcoming.list()))._tag).toBe("HomeOffline")
    }).pipe(Effect.provide(testAppDroppingOn("radarr GET /api/v3/calendar"))))
})
