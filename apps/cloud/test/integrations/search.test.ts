import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi } from "@quai/api"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { searchPath, searchResults, seasonChoices, SeerrSearchPage, SeerrSeries } from "../../src/integrations/seerr.ts"
import { type FakeHomeOptions, makeFakeHome, recordedHome } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { TestApp } from "../testApp.ts"

const now = Date.parse("2026-11-20T10:00:00Z")
const services = ["radarr", "sonarr", "seerr"] as const

/** Quai Home answering Seerr from the recordings; `created` is what a new request answers. */
const seerrAnswers = (
  created: () => { status?: number; json: unknown } = () => ({
    status: 201,
    json: fixture("seerr/request-created.json")
  })
) =>
  recordedHome({
    "seerr GET /api/v1/search": "seerr/search-dune.json",
    "seerr GET /api/v1/tv/95396": "seerr/tv.json",
    "seerr GET /api/v1/user": "seerr/users.json",
    "seerr POST /api/v1/request": () => created()
  })

describe("Seerr's search, read", () => {
  it("keeps the movies and series, in Seerr's order, with where each stands", () => {
    const results = searchResults(Schema.decodeUnknownSync(SeerrSearchPage)(fixture("seerr/search-dune.json")))
    expect(results.map((result) => [result.kind, result.tmdbId, result.title, result.year, result.state])).toEqual([
      ["movie", 438631, "Dune", 2021, "available"],
      ["movie", 693134, "Dune: Part Two", 2024, "requested"],
      ["series", 90228, "Dune: Prophecy", 2024, "requestable"],
      ["movie", 841, "Dune", 1984, "requestable"],
      ["movie", 1225914, "Dune: Part Three", undefined, "requestable"]
    ])
    expect(results[0]!.posterUrl).toBe("https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg")
    expect(results[4]).toEqual({ kind: "movie", tmdbId: 1225914, title: "Dune: Part Three", state: "requestable" })
  })

  it("encodes the query the way Seerr wants it, apostrophes and brackets included", () => {
    expect(searchPath("Ocean's Eleven (2001)!")).toBe("/api/v1/search?query=Ocean%27s%20Eleven%20%282001%29%21&page=1")
    expect(searchPath("Amélie")).toBe("/api/v1/search?query=Am%C3%A9lie&page=1")
  })

  it("lists a series' seasons but the specials: in the library, asked for, or free to request", () => {
    expect(seasonChoices(Schema.decodeUnknownSync(SeerrSeries)(fixture("seerr/tv.json")))).toEqual([
      { number: 1, episodes: 9, state: "available" },
      { number: 2, episodes: 10, state: "requested" },
      { number: 3, episodes: 1, state: "requestable" }
    ])
  })
})

describe("search and request routes", () => {
  const iphone = { name: "iPhone de Julie", apnsEnvironment: "development" as const }
  const setUp = (options: FakeHomeOptions) =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome(options)
      yield* home.connect
      const console = yield* HttpApiTest.groups(QuaiApi, ["console"])
      const qr = yield* console.console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const api = yield* HttpApiTest.groups(QuaiApi, ["requests", "devices"]).pipe(
        Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) =>
          next(HttpClientRequest.bearerToken(request, token))))
      )
      const posts = () =>
        home.calls.filter((call) => call.method === "POST")
      return { home, api: api.requests, devices: api.devices, posts }
    })

  it.effect("searches Seerr with the query encoded, and asks nothing for an empty one", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ services, answer: seerrAnswers() })
      const found = yield* api.search({ query: { query: "  dune  " } })
      expect(found.status).toBe("ok")
      expect(found.items.map((result) => result.title)).toEqual([
        "Dune",
        "Dune: Part Two",
        "Dune: Prophecy",
        "Dune",
        "Dune: Part Three"
      ])
      expect(home.calls.map((call) => call.path)).toContain("/api/v1/search?query=dune&page=1")
      const calls = home.calls.length
      expect(yield* api.search({ query: { query: "   " } })).toEqual({ items: [], status: "ok" })
      expect(home.calls).toHaveLength(calls)
    }).pipe(Effect.provide(TestApp)))

  it.effect("lists a series' seasons to choose from", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services, answer: seerrAnswers() })
      const { seasons } = yield* api.seasons({ params: { tmdbId: "95396" } })
      expect(seasons.map((season) => [season.number, season.state])).toEqual([[1, "available"], [2, "requested"], [
        3,
        "requestable"
      ]])
      expect((yield* Effect.flip(api.seasons({ params: { tmdbId: "dune" } })))._tag).toBe("NotFound")
    }).pipe(Effect.provide(TestApp)))

  it.effect("requests a movie as Seerr's admin while the iPhone chose nobody, then as the user it chose", () =>
    Effect.gen(function*() {
      const { api, devices, posts } = yield* setUp({ services, answer: seerrAnswers() })
      expect(yield* api.create({ payload: { kind: "movie", tmdbId: 841 } })).toEqual({ status: "approved" })
      yield* devices.savePreferences({ payload: { flows: {}, seerrUserId: 2 } })
      yield* api.create({ payload: { kind: "movie", tmdbId: 841 } })
      expect(posts().map((call) => [call.path, call.body])).toEqual([
        ["/api/v1/request", { mediaType: "movie", mediaId: 841 }],
        ["/api/v1/request", { mediaType: "movie", mediaId: 841, userId: 2 }]
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("requests the seasons chosen of a series, and says when Seerr left it waiting", () =>
    Effect.gen(function*() {
      const { api, posts } = yield* setUp({
        services,
        answer: seerrAnswers(() => ({
          status: 201,
          json: { ...(fixture("seerr/request-created.json") as object), status: 1 }
        }))
      })
      expect(yield* api.create({ payload: { kind: "series", tmdbId: 90228, seasons: [2, 1, 2] } })).toEqual({
        status: "pending"
      })
      expect(posts().map((call) => call.body)).toEqual([{ mediaType: "tv", mediaId: 90228, seasons: [1, 2] }])
    }).pipe(Effect.provide(TestApp)))

  it.effect("refuses a series with no season, or a movie with some, before asking Seerr", () =>
    Effect.gen(function*() {
      const { api, posts } = yield* setUp({ services, answer: seerrAnswers() })
      expect((yield* Effect.flip(api.create({ payload: { kind: "series", tmdbId: 90228 } })))._tag).toBe(
        "RequestFailed"
      )
      expect((yield* Effect.flip(api.create({ payload: { kind: "series", tmdbId: 90228, seasons: [] } })))._tag).toBe(
        "RequestFailed"
      )
      expect((yield* Effect.flip(api.create({ payload: { kind: "movie", tmdbId: 841, seasons: [1] } })))._tag).toBe(
        "RequestFailed"
      )
      expect(posts()).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("passes Seerr's refusal on, in its words", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({
        services,
        answer: seerrAnswers(() => ({ status: 409, json: { message: "Request for this media already exists." } }))
      })
      const refused = yield* Effect.flip(api.create({ payload: { kind: "movie", tmdbId: 438631 } }))
      expect(refused).toMatchObject({ _tag: "RequestFailed", message: "Request for this media already exists." })
    }).pipe(Effect.provide(TestApp)))

  it.effect("lists Seerr's users by the names Seerr gives them", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services, answer: seerrAnswers() })
      expect(yield* api.users()).toEqual({
        items: [{ id: 1, name: "Mathieu" }, { id: 2, name: "Julie" }],
        status: "ok"
      })
    }).pipe(Effect.provide(TestApp)))

  it.effect("a Quai Home before protocol 8: says to update it, and asks it nothing", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ services, protocol: 7, answer: seerrAnswers() })
      expect(yield* api.search({ query: { query: "dune" } })).toEqual({ items: [], status: "outdated" })
      expect(yield* api.users()).toEqual({ items: [], status: "outdated" })
      const refused = yield* Effect.flip(api.create({ payload: { kind: "movie", tmdbId: 841 } }))
      expect(refused).toMatchObject({ _tag: "RequestFailed", message: "Update Quai Home to request from the app." })
      expect(home.calls.filter((call) => call.service === "seerr")).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("without Seerr: not configured, and nothing to request", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services: ["radarr"] })
      expect(yield* api.search({ query: { query: "dune" } })).toEqual({ items: [], status: "notConfigured" })
      expect((yield* Effect.flip(api.create({ payload: { kind: "movie", tmdbId: 841 } })))._tag).toBe("NotFound")
    }).pipe(Effect.provide(TestApp)))

  it.effect("Seerr not answering the search: unavailable", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services, answer: () => ({ failed: "unreachable" }) })
      expect(yield* api.search({ query: { query: "dune" } })).toEqual({ items: [], status: "unavailable" })
    }).pipe(Effect.provide(TestApp)))
})
