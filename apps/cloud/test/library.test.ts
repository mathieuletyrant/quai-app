import { DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { Activities } from "../src/flows/Activities.ts"
import { decodeSonarrWebhook, librarySeries, SonarrSeries, sonarrEvents } from "../src/integrations/sonarr.ts"
import { DiskSpaces, libraryMovie, mediaDisk, RadarrMovies } from "../src/integrations/radarr.ts"
import { Schema } from "effect"
import { makeFakeHome, type FakeHomeOptions } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { TestApp } from "./testApp.ts"

const iphone = { name: "iPhone", apnsEnvironment: "development" as const }

const recorded: FakeHomeOptions["answer"] = (call) => {
  const path = call.path.split("?")[0]
  if (call.service === "radarr" && path === "/api/v3/movie") return { json: fixture("radarr/movies.json") }
  if (call.service === "radarr" && path === "/api/v3/diskspace") return { json: fixture("radarr/diskspace.json") }
  if (call.service === "sonarr" && path === "/api/v3/series") return { json: fixture("sonarr/series.json") }
  return { status: 404 }
}

/** Connects a fake home, pairs an iPhone, and returns its signed-in client. */
const phoneOn = (options: FakeHomeOptions) =>
  Effect.gen(function*() {
    const home = yield* makeFakeHome(options)
    yield* home.connect
    const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
    const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
    const api = yield* HttpApiTest.groups(QuaiApi, ["library"]).pipe(
      Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
    )
    return { home, api }
  })

describe("library adapters", () => {
  it.effect("reads Radarr's movies: file or not, the public poster, never the key-bound one", () =>
    Effect.gen(function*() {
      const movies = yield* Schema.decodeUnknownEffect(RadarrMovies)(fixture("radarr/movies.json"))
      expect(movies.map(libraryMovie)).toEqual([
        {
          id: "movie:12",
          kind: "movie",
          title: "Dune: Part Two",
          year: 2024,
          posterUrl: "https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
          status: "available",
          addedAt: 1717357267,
          sizeBytes: 18734029312,
          overview: expect.stringContaining("Paul Atreides")
        },
        {
          id: "movie:48",
          kind: "movie",
          title: "Runner",
          year: 2026,
          posterUrl: "https://image.tmdb.org/t/p/original/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
          status: "wanted",
          addedAt: 1795035524,
          sizeBytes: 0,
          overview: "A young runner chases one last race across the desert."
        },
        { id: "movie:51", kind: "movie", title: "Nero", year: 2027, status: "wanted", addedAt: 1794298323, sizeBytes: 0 }
      ])
    }))

  it.effect("reads Sonarr's series: available once every expected episode has a file", () =>
    Effect.gen(function*() {
      const series = yield* Schema.decodeUnknownEffect(SonarrSeries)(fixture("sonarr/series.json"))
      expect(series.map(librarySeries).map((s) => [s.title, s.status, s.episodes, s.posterUrl])).toEqual([
        ["Severance", "wanted", { have: 17, total: 19 }, "https://artworks.thetvdb.com/banners/posters/371980-2.jpg"],
        ["The Bear", "available", { have: 8, total: 8 }, "https://artworks.thetvdb.com/banners/v4/series/403245/posters/62a8b2a2f2f0d.jpg"]
      ])
      // Nothing on disk: wanted while the series is monitored, coming episode or not.
      const empty = { episodeFileCount: 0, episodeCount: 0, sizeOnDisk: 0 }
      expect(librarySeries({ ...series[1]!, statistics: empty, nextAiring: "2026-12-01T02:00:00Z" }).status).toBe("wanted")
      expect(librarySeries({ ...series[1]!, statistics: empty }).status).toBe("wanted")
      expect(librarySeries({ ...series[1]!, statistics: empty, monitored: false }).status).toBe("notMonitored")
      // Unmonitored with its files: on disk, whatever is missing.
      expect(librarySeries({ ...series[0]!, monitored: false }).status).toBe("available")
    }))

  it.effect("a series watched, then deleted, and left unmonitored isn't wanted", () =>
    Effect.gen(function*() {
      const [reacher] = yield* Schema.decodeUnknownEffect(SonarrSeries)(fixture("sonarr/series-unmonitored.json"))
      expect(librarySeries(reacher!)).toMatchObject({ title: "Reacher", status: "notMonitored", episodes: { have: 0, total: 0 }, sizeBytes: 0 })
    }))

  it.effect("an announced series, nothing aired nor dated yet, is wanted", () =>
    Effect.gen(function*() {
      const [announced] = yield* Schema.decodeUnknownEffect(SonarrSeries)(fixture("sonarr/series-announced.json"))
      expect(announced!.nextAiring).toBeUndefined()
      expect(librarySeries(announced!)).toMatchObject({ title: "The Last of Us", status: "wanted", episodes: { have: 0, total: 0 }, sizeBytes: 0 })
    }))

  it.effect("a movie without its file and unmonitored isn't wanted", () =>
    Effect.gen(function*() {
      const [oppenheimer] = yield* Schema.decodeUnknownEffect(RadarrMovies)(fixture("radarr/movie-unmonitored.json"))
      expect(libraryMovie(oppenheimer!)).toMatchObject({ title: "Oppenheimer", status: "notMonitored", sizeBytes: 0 })
      expect(libraryMovie({ ...oppenheimer!, monitored: true }).status).toBe("wanted")
    }))

  it.effect("the media disk is the largest mount Radarr sees", () =>
    Effect.gen(function*() {
      const disks = yield* Schema.decodeUnknownEffect(DiskSpaces)(fixture("radarr/diskspace.json"))
      expect(mediaDisk(disks)).toEqual({ freeBytes: 759102349312, totalBytes: 1800360124416 })
      expect(mediaDisk([])).toBeUndefined()
    }))
})

describe("GET /api/library", () => {
  it.effect("lists movies and series newest first, with the disk, and what downloads now", () =>
    Effect.gen(function*() {
      const { home, api } = yield* phoneOn({ answer: recorded })
      // Sonarr grabbed an episode of Severance: its download activity runs.
      const grab = yield* decodeSonarrWebhook(fixture("sonarr/grab.json"))
      for (const event of sonarrEvents(grab)) yield* (yield* Activities).handle(event)

      const library = yield* api.library.library()
      expect(library.items.map((i) => [i.id, i.status])).toEqual([
        ["movie:48", "wanted"],
        ["movie:51", "wanted"],
        ["series:3", "downloading"],
        ["series:7", "available"],
        ["movie:12", "available"]
      ])
      expect(library.disk).toEqual({ freeBytes: 759102349312, totalBytes: 1800360124416 })
      expect(library.unavailable).toEqual([])
      expect(home.calls.map((c) => `${c.service} ${c.method} ${c.path}`).sort()).toEqual([
        "radarr GET /api/v3/diskspace",
        "radarr GET /api/v3/movie",
        "sonarr GET /api/v3/series"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service that doesn't answer is unavailable; the others still show", () =>
    Effect.gen(function*() {
      const { api } = yield* phoneOn({
        answer: (call) => call.service === "sonarr" ? { failed: "sonarr is not configured" } : recorded(call)
      })
      const library = yield* api.library.library()
      expect(library.unavailable).toEqual(["sonarr"])
      expect(library.items.map((i) => i.kind)).toEqual(["movie", "movie", "movie"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("only asks the services Quai Home reaches; the disk falls back to Sonarr", () =>
    Effect.gen(function*() {
      const { home, api } = yield* phoneOn({
        services: ["sonarr", "qbittorrent"],
        answer: (call) => call.path === "/api/v3/diskspace" ? { json: fixture("radarr/diskspace.json") } : recorded(call)
      })
      const library = yield* api.library.library()
      expect(library.items.map((i) => i.id)).toEqual(["series:3", "series:7"])
      expect(library.disk?.totalBytes).toBe(1800360124416)
      expect(home.calls.every((c) => c.service === "sonarr")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("needs the iPhone's token", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ answer: recorded })
      yield* home.connect
      const anonymous = yield* HttpApiTest.groups(QuaiApi, ["library"])
      expect(Exit.isFailure(yield* Effect.exit(anonymous.library.library()))).toBe(true)
      expect(home.calls).toEqual([])
    }).pipe(Effect.provide(TestApp)))
})
