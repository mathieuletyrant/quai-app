import { DeviceAuth, HomeProtocol, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { movieResult, RadarrLookup } from "../src/integrations/radarr.ts"
import { seriesResult, SonarrLookup } from "../src/integrations/sonarr.ts"
import { Journal } from "../src/journal/Journal.ts"
import { type FakeHomeOptions, makeFakeHome, recordedHome, type Recording } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { TestApp } from "./testApp.ts"

const iphone = { name: "iPhone", apnsEnvironment: "development" as const }
const services = ["radarr", "sonarr", "seerr"] as const

const routes: Readonly<Record<string, Recording>> = {
  "radarr GET /api/v3/movie/lookup": "radarr/movie-lookup.json",
  "sonarr GET /api/v3/series/lookup": "sonarr/series-lookup.json",
  // Seerr's page of a movie, as recorded for another one: renamed to the title asked for.
  "seerr GET /api/v1/movie/438631": { json: { ...(fixture("seerr/movie.json") as object), id: 438631, title: "Dune", releaseDate: "2021-09-15" } },
  "seerr POST /api/v1/request": "seerr/request-created.json",
  "seerr GET /api/v1/request": { json: { results: [] } }
}

/** The journal reaches Quai Home in batches: hand it the lines written so far. */
const journalSent = Effect.gen(function*() {
  yield* (yield* Journal).flush
  yield* TestClock.adjust("2 seconds")
})

/** Connects a fake home, pairs an iPhone, and returns its signed-in search and requests. */
const phoneOn = (options: FakeHomeOptions) =>
  Effect.gen(function*() {
    const home = yield* makeFakeHome(options)
    yield* home.connect
    const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
    const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
    const api = yield* HttpApiTest.groups(QuaiApi, ["search", "requests"]).pipe(
      Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
    )
    return { home, search: api.search, requests: api.requests }
  })

describe("search adapters", () => {
  it.effect("reads Radarr's lookup: in the library with its file, or not added; the public poster only", () =>
    Effect.gen(function*() {
      const movies = yield* Schema.decodeUnknownEffect(RadarrLookup)(fixture("radarr/movie-lookup.json"))
      expect(movies.map(movieResult)).toEqual([
        {
          id: "movie:tmdb:438631",
          kind: "movie",
          title: "Dune",
          year: 2021,
          posterUrl: "https://image.tmdb.org/t/p/original/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
          overview: expect.stringContaining("Paul Atreides"),
          state: "notAdded",
          tmdbId: 438631
        },
        {
          id: "movie:tmdb:693134",
          kind: "movie",
          title: "Dune: Part Two",
          year: 2024,
          posterUrl: "https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
          overview: expect.stringContaining("Chani"),
          state: "available",
          tmdbId: 693134
        },
        {
          id: "movie:tmdb:841",
          kind: "movie",
          title: "Dune",
          year: 1984,
          overview: expect.stringContaining("Arrakis"),
          state: "notAdded",
          tmdbId: 841
        }
      ])
    }))

  it.effect("reads Sonarr's lookup: the TMDB id a request needs, when Sonarr knows it", () =>
    Effect.gen(function*() {
      const series = yield* Schema.decodeUnknownEffect(SonarrLookup)(fixture("sonarr/series-lookup.json"))
      expect(series.map(seriesResult).map((s) => [s.id, s.title, s.year, s.state, s.tmdbId])).toEqual([
        ["series:tvdb:367118", "Dune: Prophecy", 2024, "notAdded", 90228],
        ["series:tvdb:79054", "Frank Herbert's Dune", 2000, "notAdded", undefined]
      ])
    }))

  it("a movie in Radarr without its file is wanted; a series with an episode on disk is available", () => {
    expect(movieResult({ id: 3, title: "Runner", tmdbId: 1, hasFile: false }).state).toBe("wanted")
    expect(seriesResult({ id: 3, title: "Severance", tvdbId: 1, statistics: { episodeFileCount: 4 } }).state).toBe("available")
    expect(seriesResult({ id: 3, title: "Severance", tvdbId: 1, statistics: { episodeFileCount: 0 } }).state).toBe("wanted")
  })
})

describe("search", () => {
  it.effect("asks Radarr and Sonarr at once, movies first, and says a title can be requested", () =>
    Effect.gen(function*() {
      const { home, search } = yield* phoneOn({ services: [...services], answer: recordedHome(routes) })
      const results = yield* search.search({ query: { q: "dune prophecy" } })
      expect(results.items.map((r) => r.id)).toEqual(["movie:tmdb:438631", "movie:tmdb:693134", "movie:tmdb:841", "series:tvdb:367118", "series:tvdb:79054"])
      expect(results.unavailable).toEqual([])
      expect(results.canRequest).toBe(true)
      expect(home.calls.map((c) => `${c.service} ${c.path}`).sort()).toEqual([
        "radarr /api/v3/movie/lookup?term=dune%20prophecy",
        "sonarr /api/v3/series/lookup?term=dune%20prophecy"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a service that doesn't answer is unavailable, the other one still shows", () =>
    Effect.gen(function*() {
      const { search } = yield* phoneOn({
        services: [...services],
        answer: recordedHome(routes, { "sonarr GET /api/v3/series/lookup": { failed: "unreachable" } })
      })
      const results = yield* search.search({ query: { q: "dune" } })
      expect(results.items.map((r) => r.kind)).toEqual(["movie", "movie", "movie"])
      expect(results.unavailable).toEqual(["sonarr"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("only blanks: nothing is asked", () =>
    Effect.gen(function*() {
      const { home, search } = yield* phoneOn({ services: [...services], answer: recordedHome(routes) })
      expect(yield* search.search({ query: { q: "   " } })).toEqual({ items: [], unavailable: [], canRequest: true })
      expect(home.calls).toHaveLength(0)
    }).pipe(Effect.provide(TestApp)))

  it.effect("without Seerr, the search works and nothing can be requested", () =>
    Effect.gen(function*() {
      const { home, search, requests } = yield* phoneOn({ services: ["radarr", "sonarr"], answer: recordedHome(routes) })
      const results = yield* search.search({ query: { q: "dune" } })
      expect(results.items).toHaveLength(5)
      expect(results.canRequest).toBe(false)
      const refused = yield* Effect.flip(requests.create({ payload: { kind: "movie", tmdbId: 438631 } }))
      expect(refused._tag).toBe("RequestsNotConfigured")
      expect(home.calls.filter((c) => c.method === "POST")).toHaveLength(0)
    }).pipe(Effect.provide(TestApp)))

  it.effect("an older Quai Home refuses the lookups: both services are unavailable", () =>
    Effect.gen(function*() {
      const { search } = yield* phoneOn({
        services: [...services],
        answer: recordedHome(routes),
        protocol: HomeProtocol.searchProtocolVersion - 1,
        strict: false
      })
      const results = yield* search.search({ query: { q: "dune" } })
      expect(results.items).toEqual([])
      expect(results.unavailable).toEqual(["radarr", "sonarr"])
    }).pipe(Effect.provide(TestApp)))
})

describe("requesting a title", () => {
  it.effect("asks Seerr as its owner with its defaults, names the title in the journal, reads the requests again", () =>
    Effect.gen(function*() {
      const { home, requests } = yield* phoneOn({ services: [...services], answer: recordedHome(routes) })
      yield* requests.create({ payload: { kind: "movie", tmdbId: 438631 } })
      yield* journalSent
      const posts = home.calls.filter((c) => c.method === "POST")
      expect(posts.map((c) => [c.service, c.path, c.body])).toEqual([
        ["seerr", "/api/v1/request", { mediaType: "movie", mediaId: 438631 }]
      ])
      // Quai Home's own check: the body the Cloud sent is one it lets through.
      expect(HomeProtocol.allowed({ service: "seerr", method: "POST", path: "/api/v1/request", body: posts[0]!.body })).toBe(true)
      expect(home.journal.map((e) => `${e.level} ${e.kind} ${e.text}`)).toContain("info request.created Requested Dune in Seerr")
    }).pipe(Effect.provide(TestApp)))

  it.effect("a series asks for its first season", () =>
    Effect.gen(function*() {
      const { home, requests } = yield* phoneOn({ services: [...services], answer: recordedHome(routes) })
      yield* requests.create({ payload: { kind: "series", tmdbId: 90228 } })
      expect(home.calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ mediaType: "tv", mediaId: 90228, seasons: [1] }])
    }).pipe(Effect.provide(TestApp)))

  it.effect("Seerr refusing is a RequestFailed in its words, and the journal says so", () =>
    Effect.gen(function*() {
      const { home, requests } = yield* phoneOn({
        services: [...services],
        answer: recordedHome(routes, { "seerr POST /api/v1/request": { status: 409, json: { message: "Request for this media already exists." } } })
      })
      const refused = yield* Effect.flip(requests.create({ payload: { kind: "movie", tmdbId: 438631 } }))
      expect(refused).toMatchObject({ _tag: "RequestFailed", message: "Request for this media already exists." })
      yield* journalSent
      expect(home.journal.at(-1)).toMatchObject({
        level: "warn",
        kind: "request.created.failed",
        text: "Requested Dune in Seerr: failed, Request for this media already exists.",
        deviceName: "iPhone"
      })
    }).pipe(Effect.provide(TestApp)))

  it.effect("refuses a TMDB id that isn't one", () =>
    Effect.gen(function*() {
      const { home, requests } = yield* phoneOn({ services: [...services], answer: recordedHome(routes) })
      const refused = yield* Effect.flip(requests.create({ payload: { kind: "movie", tmdbId: 0 } }))
      expect(refused._tag).not.toBe("RequestFailed")
      expect(home.calls.filter((c) => c.method === "POST")).toHaveLength(0)
    }).pipe(Effect.provide(TestApp)))
})
