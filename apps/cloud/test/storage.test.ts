import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi } from "@quai/api"
import { Effect, Exit, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { goneItem } from "../src/gone/Gone.ts"
import { HomeDocuments } from "../src/home/HomeLink.ts"
import { HomeTime } from "../src/home/HomeTime.ts"
import { mountsWatchId, rootsWatchId } from "../src/integrations/disk.ts"
import { radarrArrival } from "../src/integrations/radarr.ts"
import { sonarrArrival } from "../src/integrations/sonarr.ts"
import {
  arrivedMark,
  departureOf,
  DiskReadings,
  goneMark,
  marksDisk,
  periodStart,
  resolution,
  withReading
} from "../src/storage/DiskReadings.ts"
import { type DiskView, mediaDisks, mountOf } from "../src/storage/MediaDisks.ts"
import { isLow, storageDisk } from "../src/storage/Storage.ts"
import { type FakeHomeOptions, makeFakeHome, recordedHome } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { TestApp } from "./testApp.ts"

const tera = 1e12
const hour = 3600_000
const day = 24 * hour
/** Noon on the day of the fixtures. */
const now = Date.parse("2026-11-26T12:00:00Z")

const mount = (path: string, freeSpace: number, totalSpace: number) => ({ path, freeSpace, totalSpace })

/** Radarr's mounts on a home with the movies on one disk and the shows on another. */
const twoDisks = [
  mount("/", 4e10, 6e10),
  mount("/movies", 1.4 * tera, 4 * tera),
  mount("/shows", 1.6e11, 2 * tera)
]

describe("media disks", () => {
  it("a root folder is on the longest mount its path starts with, never a mere prefix of a name", () => {
    const mounts = [mount("/", 1, 2), mount("/downloads", 1, 3), mount("/downloads2", 1, 4)]
    expect(mountOf("/downloads/movies", mounts)?.path).toBe("/downloads")
    expect(mountOf("/downloads2/shows", mounts)?.path).toBe("/downloads2")
    expect(mountOf("/downloads", mounts)?.path).toBe("/downloads")
    expect(mountOf("/elsewhere", mounts)?.path).toBe("/")
    expect(mountOf("/elsewhere", [mount("/downloads", 1, 3)])).toBeUndefined()
  })

  it("the disks holding the root folders, named by what they hold, fullest first", () => {
    const views: ReadonlyArray<DiskView> = [
      { service: "radarr", mounts: twoDisks, roots: [{ path: "/movies" }] },
      { service: "sonarr", mounts: twoDisks, roots: [{ path: "/shows" }, { path: "/shows/anime" }] }
    ]
    expect(mediaDisks(views)).toEqual([
      { id: "d2000000000000", name: "Shows", holds: ["shows"], freeBytes: 1.6e11, totalBytes: 2 * tera },
      { id: "d4000000000000", name: "Movies", holds: ["movies"], freeBytes: 1.4 * tera, totalBytes: 4 * tera }
    ])
  })

  it("the same disk seen by Radarr and Sonarr, under other paths and a moment apart, is one", () => {
    const radarr = [mount("/downloads", 7.59e11, 1.8 * tera)]
    const sonarr = [mount("/data", 7.59e11 - 5e8, 1.8 * tera)]
    expect(mediaDisks([
      { service: "radarr", mounts: radarr, roots: [{ path: "/downloads/movies" }] },
      { service: "sonarr", mounts: sonarr, roots: [{ path: "/data/shows" }] }
    ])).toEqual([{
      id: "d1800000000000",
      name: "Movies · Shows",
      holds: ["movies", "shows"],
      freeBytes: 7.59e11,
      totalBytes: 1.8 * tera
    }])
    // Sonarr's reading kept from an hour ago, 6 GB downloaded since: still the same disk.
    const earlier = [mount("/data", 7.59e11 + 6e9, 1.8 * tera)]
    expect(
      mediaDisks([
        { service: "radarr", mounts: radarr, roots: [{ path: "/downloads/movies" }] },
        { service: "sonarr", mounts: earlier, roots: [{ path: "/data/shows" }] }
      ]).map((disk) => [disk.id, disk.name])
    ).toEqual([["d1800000000000", "Movies · Shows"]])
  })

  it("two disks of the same size, seen at once by one service, are two, told apart by their mount", () => {
    const twins = [mount("/movies", 7e11, 2 * tera), mount("/shows", 3e11, 2 * tera)]
    const disks = mediaDisks([
      { service: "radarr", mounts: twins, roots: [{ path: "/movies" }, { path: "/shows" }] },
      { service: "sonarr", mounts: twins, roots: [{ path: "/shows" }] }
    ])
    expect(disks.map((disk) => [disk.id, disk.name])).toEqual([
      ["d2000000000000-shows", "Movies · Shows"],
      ["d2000000000000-movies", "Movies"]
    ])
  })

  it("without root folders (an older Quai Home, or they didn't answer), the largest disk holds the media", () => {
    expect(mediaDisks([{ service: "radarr", mounts: fixture("radarr/diskspace.json") as never }])).toEqual([{
      id: "d1800360124416",
      name: "Movies",
      holds: ["movies"],
      freeBytes: 759102349312,
      totalBytes: 1800360124416
    }])
    expect(mediaDisks([{ service: "radarr", mounts: [] }])).toEqual([])
    expect(mediaDisks([{ service: "radarr", mounts: [mount("/", 0, 0)] }])).toEqual([])
    expect(mediaDisks([])).toEqual([])
  })
})

describe("disk readings: the rules", () => {
  it("one reading an hour: a second one in the same hour is dropped", () => {
    const first = withReading({ readings: [] }, now, 10)!
    expect(first.readings).toEqual([[now, 10]])
    expect(withReading(first, now + hour - 1 - (now % hour), 9)).toBeNull()
    expect(withReading(first, now + hour, 9)?.readings).toEqual([[now, 10], [now + hour, 9]])
    // A clock that went back writes nothing over what is there.
    expect(withReading(first, now - hour, 11)).toBeNull()
  })

  it("hourly up to 30 days, the last reading of each of the home's days beyond", () => {
    const readings = [0, 6, 20, 30].map((hours) => ({ at: now + hours * hour, freeBytes: hours }))
    expect(resolution(readings, "30d", "Europe/Paris")).toEqual(readings)
    // Noon UTC and 6 PM UTC are the 26th in Paris; 8 AM UTC on the 27th is its day, 6 PM the 27th too.
    expect(resolution(readings, "1y", "Europe/Paris").map((reading) => reading.freeBytes)).toEqual([6, 30])
    expect(resolution([], "all", "UTC")).toEqual([])
    expect(periodStart("7d", now)).toBe(now - 7 * day)
    expect(periodStart("all", now)).toBe(Number.NEGATIVE_INFINITY)
  })

  it("a title's imports of the day add up in one arrived mark", () => {
    const dune = { service: "radarr" as const, titleKey: "movie:tmdb:1", title: "Dune", at: now, bytes: 12e9 }
    expect(arrivedMark(dune, "2026-11-26", undefined)).toEqual({
      id: "arrived:movie:tmdb:1:2026-11-26",
      at: now,
      kind: "arrived",
      service: "radarr",
      title: "Dune",
      detail: "Imported",
      bytes: 12e9,
      holds: "movies"
    })
    const episode = {
      service: "sonarr" as const,
      titleKey: "series:tvdb:9",
      title: "Severance",
      at: now,
      bytes: 2e9,
      episodes: [{ season: 2 }]
    }
    const first = arrivedMark(episode, "2026-11-26", undefined)
    expect([first.title, first.detail]).toEqual(["Severance S02", "1 episode imported"])
    const pack = arrivedMark(
      { ...episode, at: now + hour, bytes: 1.6e10, episodes: Array(7).fill({ season: 2 }) },
      "2026-11-26",
      first
    )
    expect([pack.at, pack.title, pack.detail, pack.bytes]).toEqual([
      now,
      "Severance S02",
      "8 episodes imported",
      1.8e10
    ])
    // Across seasons: the series alone.
    const later = arrivedMark({ ...episode, episodes: [{ season: 3 }] }, "2026-11-26", pack)
    expect([later.title, later.seasons]).toEqual(["Severance", [2, 3]])
    // A size Radarr didn't send: no size.
    expect(arrivedMark({ ...dune, bytes: 0 }, "2026-11-26", undefined).bytes).toBeUndefined()
  })

  it("a gone mark says what happened, and carries the space back only when sure", () => {
    const deleted = goneItem({
      kind: "plannedDeletion",
      source: "reclaimerr",
      at: now,
      title: "Up",
      detail: "Deleted by Reclaimerr · 24 GB back",
      spaceBack: 24e9,
      holds: "movies"
    })
    expect(goneMark(departureOf(deleted))).toEqual({
      id: `gone:reclaimerr:${now}:Up`,
      at: now,
      kind: "gone",
      service: "reclaimerr",
      title: "Up",
      detail: "Deleted",
      bytes: 24e9,
      holds: "movies"
    })
    const { spaceBack: _, ...unsized } = deleted
    expect(departureOf({ ...unsized, moved: true }).detail).toBe("Moved")
    const cleaned = departureOf(
      goneItem({ kind: "seedCleanup", source: "cleanuparr", at: now, title: "A torrent", detail: "" })
    )
    expect([cleaned.detail, cleaned.holds, cleaned.bytes]).toEqual(["Seed cleanup", undefined, undefined])
    expect(
      departureOf(goneItem({ kind: "stuckRemoval", source: "cleanuparr", at: now, title: "x", detail: "" })).detail
    )
      .toBe("Stuck removal")
  })

  it("a mark goes on the disks holding what it is about, on every disk when Quai can't tell", () => {
    expect(marksDisk({ holds: "movies" }, { holds: ["movies", "shows"] })).toBe(true)
    expect(marksDisk({ holds: "movies" }, { holds: ["shows"] })).toBe(false)
    expect(marksDisk({}, { holds: ["shows"] })).toBe(true)
  })

  it("an import webhook is an arrival with its file sizes; any other event, none", () => {
    const radarr = fixture("radarr/download.json") as Parameters<typeof radarrArrival>[0]
    expect(radarrArrival(radarr, now)).toEqual({
      service: "radarr",
      titleKey: "movie:tmdb:693134",
      title: "Dune: Part Two",
      at: now,
      bytes: 9876543210
    })
    expect(radarrArrival({ ...radarr, eventType: "Grab" }, now)).toBeUndefined()
    const sonarr = fixture("sonarr/download-season.json") as Parameters<typeof sonarrArrival>[0]
    expect(sonarrArrival(sonarr, now)).toMatchObject({
      bytes: 2 * 2147483648,
      episodes: [{ season: 2 }, { season: 2 }]
    })
    const { episodeFiles: _, ...single } = sonarr
    expect(sonarrArrival({ ...single, episodeFile: { size: 5 } }, now)?.bytes).toBe(5)
    expect(sonarrArrival({ ...single, eventType: "Grab" }, now)).toBeUndefined()
  })
})

describe("disk readings: kept at home", () => {
  /** The readings on an in-memory home, its day in Paris (an hour ahead of UTC in winter). */
  const kept = DiskReadings.layer.pipe(
    Layer.provide(HomeDocuments.memory),
    Layer.provide(Layer.succeed(HomeTime, { zone: Effect.succeed("Europe/Paris") }))
  )

  it.effect("a title's imports of one home day add up, even when that day starts in the previous UTC month", () =>
    Effect.gen(function*() {
      const readings = yield* DiskReadings
      const arrival = { service: "radarr" as const, titleKey: "movie:tmdb:1", title: "Dune", bytes: 1e9 }
      // 00:30 and 11:00 on Feb 1 in Paris: 23:30 on Jan 31 and 10:00 on Feb 1 in UTC.
      yield* readings.arrived({ ...arrival, at: Date.parse("2026-01-31T23:30:00Z") })
      yield* readings.arrived({ ...arrival, at: Date.parse("2026-02-01T10:00:00Z") })
      const marks = yield* readings.marks
      expect(marks.map((mark) => [mark.id, mark.bytes])).toEqual([["arrived:movie:tmdb:1:2026-02-01", 2e9]])
    }).pipe(Effect.provide(kept)))
})

describe("the Storage screen's disks", () => {
  const disk = { id: "d1", name: "Movies", holds: ["movies" as const], freeBytes: 50, totalBytes: 1000 }
  const settings = (enabled: boolean) => ({ diskLow: { enabled, belowPercent: 10 } })

  it("low under the alert's threshold, only while the alert is on", () => {
    expect(isLow(disk, settings(true))).toBe(true)
    expect(isLow(disk, settings(false))).toBe(false)
    expect(isLow({ ...disk, freeBytes: 100 }, settings(true))).toBe(false)
  })

  it("its marks of the period, and its count of all of them", () => {
    const mark = (at: number, holds?: "movies" | "shows") => ({
      id: String(at),
      at,
      kind: "gone" as const,
      service: "reclaimerr" as const,
      title: "x",
      detail: "Deleted",
      ...(holds === undefined ? {} : { holds })
    })
    const shown = storageDisk(disk, {
      readings: [{ at: 10, freeBytes: 80 }, { at: 20, freeBytes: 60 }],
      marks: [mark(30, "movies"), mark(25), mark(15, "shows"), mark(5, "movies")],
      from: 10,
      low: true
    })
    expect(shown.marks.map((one) => one.id)).toEqual(["30", "25"])
    expect([shown.allMarks, shown.low]).toEqual([3, true])
  })
})

const iphone = { name: "iPhone", apnsEnvironment: "development" as const }

const routes = recordedHome({
  "radarr GET /api/v3/diskspace": { json: twoDisks },
  "radarr GET /api/v3/rootfolder": { json: [{ path: "/movies" }] },
  "sonarr GET /api/v3/diskspace": { json: twoDisks },
  "sonarr GET /api/v3/rootfolder": { json: [{ path: "/shows" }] }
})

/** Connects a fake home, pairs an iPhone, and returns its signed-in client. */
const phoneOn = (options: FakeHomeOptions) =>
  Effect.gen(function*() {
    const home = yield* makeFakeHome(options)
    yield* home.connect
    const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
      payload: { serverUrls: [] }
    })
    const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
      payload: { ...iphone, code: qr.code }
    })
    const api = yield* HttpApiTest.groups(QuaiApi, ["storage"]).pipe(
      Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, token))))
    )
    return { home, api }
  })

describe("GET /api/storage", () => {
  it.effect("each media disk now, with its hourly readings and its marks, the fullest first", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now - 2 * hour)
      const { home, api } = yield* phoneOn({ answer: routes })
      // Quai Home's first reads of the disk watches. The shows' disk is Sonarr's: its root folder is there.
      expect(home.watch(mountsWatchId("radarr"))?.everySeconds).toBe(600)
      expect(home.watch(rootsWatchId("sonarr"))?.everySeconds).toBe(3600)
      yield* home.snapshot(rootsWatchId("radarr"), [{ path: "/movies" }])
      yield* home.snapshot(rootsWatchId("sonarr"), [{ path: "/shows" }])
      yield* home.snapshot(mountsWatchId("radarr"), twoDisks)
      yield* home.snapshot(mountsWatchId("sonarr"), twoDisks)
      // Ten minutes later, the same hour: nothing more kept.
      yield* TestClock.adjust("10 minutes")
      yield* home.snapshot(mountsWatchId("sonarr"), [twoDisks[0], twoDisks[1], mount("/shows", 1.7e11, 2 * tera)])
      yield* TestClock.setTime(now - hour)
      yield* home.snapshot(mountsWatchId("sonarr"), [twoDisks[0], twoDisks[1], mount("/shows", 1.5e11, 2 * tera)])

      // An import and something gone, an hour ago.
      yield* home.webhook("sonarr", fixture("sonarr/download-season.json"))
      yield* (yield* DiskReadings).gone(departureOf(goneItem({
        kind: "seedCleanup",
        source: "cleanuparr",
        at: now - hour,
        title: "A torrent",
        detail: ""
      })))
      yield* TestClock.setTime(now)

      const storage = yield* api.storage.storage({ query: { period: "7d" } })
      expect(storage.period).toBe("7d")
      expect(storage.unavailable).toEqual([])
      const [shows, movies] = storage.disks
      expect([shows?.name, shows?.low, shows?.freeBytes]).toEqual(["Shows", true, 1.6e11])
      expect(shows?.readings.map((reading) => reading.freeBytes)).toEqual([1.6e11, 1.5e11])
      expect(shows?.marks.map((mark) => [mark.kind, mark.service, mark.title, mark.detail])).toEqual([
        ["arrived", "sonarr", "Severance S02", "2 episodes imported"],
        ["gone", "cleanuparr", "A torrent", "Seed cleanup"]
      ])
      // The seed cleanup can't say which disk: it is on both; the import of shows isn't on Movies'.
      expect(movies?.marks.map((mark) => mark.title)).toEqual(["A torrent"])
      expect([movies?.name, movies?.low, movies?.allMarks]).toEqual(["Movies", false, 1])
      expect(storage.disks.map((disk) => disk.id)).toEqual(["d2000000000000", "d4000000000000"])

      // Kept in Quai Home: a month of readings per disk, a month of marks.
      const documents = [...home.documents.keys()].filter((key) => key.startsWith("storage/")).sort()
      expect(documents).toEqual([
        "storage/disks/d2000000000000",
        "storage/disks/d4000000000000",
        "storage/marks/2026-11",
        "storage/readings/d2000000000000/2026-11",
        "storage/readings/d4000000000000/2026-11"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a disk its service didn't answer for shows its last reading; the period reaches back as asked", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const { api } = yield* phoneOn({
        answer: recordedHome({ "radarr GET /api/v3/diskspace": { status: 500 } }),
        services: ["radarr"]
      })
      const documents = yield* HomeDocuments
      yield* documents.put("storage/disks/d9", { id: "d9", name: "Movies", holds: ["movies"], totalBytes: 1000 })
      yield* documents.put("storage/readings/d9/2025-01", { readings: [[Date.parse("2025-01-10T00:00:00Z"), 400]] })
      yield* documents.put("storage/readings/d9/2026-11", { readings: [[now - 3 * day, 300], [now - day, 200]] })

      const week = yield* api.storage.storage({ query: { period: "7d" } })
      expect(week.unavailable).toEqual(["radarr"])
      expect(week.disks.map((disk) => [disk.id, disk.freeBytes, disk.low, disk.readings.length])).toEqual([
        ["d9", 200, false, 2]
      ])
      const all = yield* api.storage.storage({ query: { period: "all" } })
      expect(all.disks[0]?.readings.map((reading) => reading.freeBytes)).toEqual([400, 300, 200])
      // No period: 30 days.
      expect((yield* api.storage.storage({ query: {} })).period).toBe("30d")
    }).pipe(Effect.provide(TestApp)))

  it.effect("with every service answering, a disk kept but not read now is gone from the screen", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const { api } = yield* phoneOn({ answer: routes })
      const documents = yield* HomeDocuments
      // A disk once taken for a second one, from a reading an hour old.
      yield* documents.put("storage/disks/d4000000000000-old", {
        id: "d4000000000000-old",
        name: "Movies",
        holds: ["movies"],
        totalBytes: 4 * tera
      })
      yield* documents.put("storage/readings/d4000000000000-old/2026-11", { readings: [[now - hour, 1.4 * tera]] })
      const storage = yield* api.storage.storage({ query: { period: "30d" } })
      expect(storage.unavailable).toEqual([])
      expect(storage.disks.map((disk) => disk.id)).toEqual(["d2000000000000", "d4000000000000"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("an older Quai Home: no root folders asked, the largest disk is the media disk", () =>
    Effect.gen(function*() {
      const { home, api } = yield* phoneOn({
        answer: recordedHome({ "radarr GET /api/v3/diskspace": "radarr/diskspace.json" }),
        services: ["radarr"],
        protocol: 11
      })
      expect(home.watch(rootsWatchId("radarr"))).toBeUndefined()
      const storage = yield* api.storage.storage({ query: { period: "30d" } })
      expect(storage.disks.map((disk) => [disk.name, disk.totalBytes])).toEqual([["Movies", 1800360124416]])
      expect(home.calls.map((call) => call.path)).toEqual(["/api/v3/diskspace"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("the disks are read every hour while the disk low alert is off", () =>
    Effect.gen(function*() {
      const { home } = yield* phoneOn({ answer: routes })
      const documents = yield* HomeDocuments
      yield* documents.put("alerts/settings", { diskLow: { enabled: false, belowPercent: 10 } })
      yield* home.servicesChanged(["radarr", "sonarr"])
      expect(home.watch(mountsWatchId("radarr"))?.everySeconds).toBe(3600)
    }).pipe(Effect.provide(TestApp)))

  it.effect("Quai Home offline: 503, nothing partial", () =>
    Effect.gen(function*() {
      const { api, home } = yield* phoneOn({ answer: routes })
      yield* home.disconnect
      const exit = yield* Effect.exit(api.storage.storage({ query: {} }))
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(TestApp)))
})
