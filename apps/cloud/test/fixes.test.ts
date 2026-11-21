import { DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { noSourceAfterMs } from "../src/fixes/Detected.ts"
import { isImportBlocked, QueuePage } from "../src/integrations/arr.ts"
import { blockedMovie, moviesWithoutSource } from "../src/fixes/movies.ts"
import { blockedEpisodes, episodesWithoutSource } from "../src/fixes/series.ts"
import { RadarrGrabs, RadarrMissing, RadarrMovies } from "../src/integrations/radarr.ts"
import { candidatePoster, CandidatePage, scheduledDeletions } from "../src/integrations/reclaimerr.ts"
import { SonarrGrabs, SonarrMissing, SonarrSeries } from "../src/integrations/sonarr.ts"
import { type FakeHome, type FakeHomeOptions, makeFakeHome, recordedHome, type Recording } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"
import { Journal } from "../src/journal/Journal.ts"
import { TestApp, testAppDroppingOn } from "./testApp.ts"

/** The fixtures' "now": Thursday Nov 19, 2026, noon UTC. */
const now = Date.parse("2026-11-19T12:00:00Z")
const iphone = { name: "iPhone", apnsEnvironment: "development" as const }

const decode = <A, I>(schema: Schema.Codec<A, I>, path: string) => Schema.decodeUnknownSync(schema)(fixture(path))

const upPoster = "https://image.tmdb.org/t/p/original/up-poster.jpg"
const carsPoster = "https://image.tmdb.org/t/p/original/cars-2-poster.jpg"
const lostPoster = "https://artworks.thetvdb.com/banners/posters/73739-1.jpg"

/** Radarr's library with Reclaimerr's movies in it: the recorded Dune, renamed. */
const moviesWithCandidates = (): ReadonlyArray<unknown> => {
  const movies = fixture("radarr/movies.json") as Array<Record<string, unknown>>
  const like = (id: number, title: string, year: number, tmdbId: number, poster: string) => ({
    ...movies[0],
    id,
    title,
    year,
    tmdbId,
    images: [{ coverType: "poster", url: `/MediaCover/${id}/poster.jpg`, remoteUrl: poster }]
  })
  return [...movies, like(142, "Up", 2009, 2042, upPoster), like(143, "Cars 2", 2011, 99999, carsPoster)]
}

/** The To fix reads, and every write accepted. */
const routes: Readonly<Record<string, Recording>> = {
  "radarr GET /api/v3/queue": "radarr/queue.json",
  "radarr GET /api/v3/wanted/missing": "radarr/wanted-missing.json",
  "radarr GET /api/v3/history/since": "radarr/history-since.json",
  "radarr GET /api/v3/release": "radarr/release.json",
  "radarr GET /api/v3/manualimport": "radarr/manualimport.json",
  "sonarr GET /api/v3/queue": "sonarr/queue.json",
  "sonarr GET /api/v3/wanted/missing": "sonarr/wanted-missing.json",
  "sonarr GET /api/v3/history/since": "sonarr/history-since.json",
  "sonarr GET /api/v3/release": "sonarr/release.json",
  "sonarr GET /api/v3/manualimport": "sonarr/manualimport.json",
  "sonarr GET /api/v3/episode": "sonarr/episodes.json",
  "reclaimerr GET /api/v1/candidates": "reclaimerr/candidates.json",
  "radarr DELETE /api/v3/queue/41": { json: {} },
  "sonarr DELETE /api/v3/queue/7": { json: {} },
  "radarr POST /api/v3/release": { json: {} },
  "radarr POST /api/v3/command": { status: 201, json: {} },
  "sonarr POST /api/v3/command": { status: 201, json: {} },
  "reclaimerr POST /api/v1/candidates/42/protect": { json: {} },
  "cleanuparr GET /api/strikes": "cleanuparr/strikes.json",
  "cleanuparr GET /api/configuration/queue_cleaner": "cleanuparr/queue-cleaner.json",
  "cleanuparr GET /api/queue-rules/stall": "cleanuparr/stall-rules.json",
  "cleanuparr GET /api/queue-rules/slow": "cleanuparr/slow-rules.json",
  "cleanuparr GET /api/jobs/QueueCleaner": "cleanuparr/job-queue-cleaner.json",
  "cleanuparr PUT /api/configuration/queue_cleaner": { json: { message: "QueueCleaner configuration updated successfully" } }
}
const recorded = (overrides: Readonly<Record<string, Recording>> = {}) => recordedHome(routes, overrides)

const services = ["radarr", "sonarr", "qbittorrent", "jellyfin", "reclaimerr"] as const

/** Sets the clock, connects a fake home and pairs an iPhone. */
const setUp = (options: FakeHomeOptions = {}) =>
  Effect.gen(function*() {
    yield* TestClock.setTime(now)
    const home = yield* makeFakeHome({ services, answer: recorded(), ...options })
    yield* home.connect
    const console = yield* HttpApiTest.groups(QuaiApi, ["console"])
    const qr = yield* console.console.createPairingCode({ payload: { serverUrls: [] } })
    const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
    const api = yield* HttpApiTest.groups(QuaiApi, ["fixes"]).pipe(
      Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
    )
    return { home, api: api.fixes }
  })

const writes = (home: FakeHome) =>
  home.calls.filter((c) => c.method !== "GET").map((c) => ({ service: c.service, method: c.method, path: c.path, body: c.body }))

describe("To fix rules", () => {
  it("import blocked: Radarr's blocked and warning-pending downloads, with the *arr's reason", () => {
    const queue = decode(QueuePage, "radarr/queue.json").records
    const blocked = queue.filter(isImportBlocked).map(blockedMovie)
    expect(blocked.map((d) => [d.fix.id, d.fix.title, d.fix.actions])).toEqual([
      ["blocked-radarr-41", "Dune: Part Two", ["remove"]],
      ["blocked-radarr-42", "Mouse", ["importAnyway", "remove"]],
      ["blocked-radarr-43", "Some.Removed.Movie.2019.1080p.BluRay.x264-SPARKS", ["remove"]]
    ])
    expect(blocked[0]!.fix).toMatchObject({
      kind: "importBlocked",
      service: "radarr",
      year: 2024,
      posterUrl: "https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
      reason: "Not an upgrade for existing movie file. Existing quality: Bluray-2160p. New Quality WEBDL-1080p.",
      since: Date.parse("2026-11-18T20:15:00Z") / 1000,
      download: { release: "Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-FLUX", downloadClient: "qBittorrent" }
    })
  })

  it("import blocked: Sonarr's unmatched episode, named after its series", () => {
    const [blocked] = decode(QueuePage, "sonarr/queue.json").records.filter(isImportBlocked).map(blockedEpisodes)
    expect(blocked!.fix).toMatchObject({
      id: "blocked-sonarr-7",
      title: "Amazing Stories",
      reason: "Unable to identify correct episode(s) using release name and scene mappings",
      actions: ["importAnyway", "remove"]
    })
    expect(blocked!.target).toMatchObject({ kind: "series", _tag: "Queue", seriesId: 9, downloadId: "0718293A4B5C6D7E8F901234567890123456789A" })
  })

  it("no source: available, monitored, without a file, not queued, not grabbed, for over 2 hours", () => {
    const missing = decode(RadarrMissing, "radarr/wanted-missing.json").records
    const queue = decode(QueuePage, "radarr/queue.json").records
    const grabs = decode(RadarrGrabs, "radarr/history-since.json")
    // Arco: added an hour ago. Mickey 17: grabbed yesterday. Mouse, The Wild Robot: in the queue. Nero: not out yet.
    expect(moviesWithoutSource(missing, queue, grabs, now).map((d) => [d.fix.id, d.fix.reason])).toEqual([
      ["missing-movie-48", "No release grabbed since it was added"]
    ])
    const later = moviesWithoutSource(missing, queue, grabs, now + 3600_000).map((d) => d.fix.id)
    expect(later).toEqual(["missing-movie-52", "missing-movie-48"])
    // Exactly 2 hours after Arco was added: it's a problem from that instant.
    const arco = Date.parse("2026-11-19T11:00:00Z")
    expect(moviesWithoutSource(missing, queue, grabs, arco + noSourceAfterMs - 1).map((d) => d.fix.id)).not.toContain("missing-movie-52")
    expect(moviesWithoutSource(missing, queue, grabs, arco + noSourceAfterMs).map((d) => d.fix.id)).toContain("missing-movie-52")
  })

  it("no source: never a title Radarr or Sonarr isn't monitoring", () => {
    const missing = decode(RadarrMissing, "radarr/wanted-missing.json").records
    expect(moviesWithoutSource(missing, [], [], now + 3600_000).map((d) => d.fix.id)).toContain("missing-movie-48")
    const unmonitored = missing.map((m) => ({ ...m, monitored: false }))
    expect(moviesWithoutSource(unmonitored, [], [], now + 3600_000)).toEqual([])
    const episodes = decode(SonarrMissing, "sonarr/wanted-missing.json").records
    expect(episodesWithoutSource(episodes, [], [], now)).not.toEqual([])
    expect(episodesWithoutSource(episodes.map((e) => ({ ...e, monitored: false })), [], [], now)).toEqual([])
  })

  it("no source: a movie added before it came out waits from its release", () => {
    const [runner] = decode(RadarrMissing, "radarr/wanted-missing.json").records.filter((m) => m.id === 48)
    const early = { ...runner!, added: "2026-10-01T00:00:00Z", digitalRelease: "2026-11-19T10:30:00Z" }
    expect(moviesWithoutSource([early], [], [], now)).toEqual([])
    const [late] = moviesWithoutSource([early], [], [], now + 3600_000)
    expect(late!.fix.reason).toBe("No release grabbed since it came out")
    expect(late!.fix.since).toBe(Date.parse("2026-11-19T10:30:00Z") / 1000)
  })

  it("no source: Sonarr's aired episodes, grouped by season", () => {
    const missing = decode(SonarrMissing, "sonarr/wanted-missing.json").records
    const grabs = decode(SonarrGrabs, "sonarr/history-since.json")
    // The Bear S04E01 aired 30 min ago; S03E05 was grabbed.
    const [severance, ...rest] = episodesWithoutSource(missing, [], grabs, now)
    expect(rest).toEqual([])
    expect(severance!.fix).toMatchObject({
      id: "missing-season-3-2",
      kind: "noSource",
      title: "Severance · S02",
      reason: "No release grabbed since it aired",
      since: Date.parse("2026-11-18T02:00:00Z") / 1000,
      missing: { episodes: ["S02E09", "S02E10"] }
    })
    expect(severance!.target).toEqual({ kind: "series", _tag: "Missing", seriesId: 3, seasonNumber: 2, episodeIds: [309, 310] })
  })

  it("scheduled deletion: what Reclaimerr deletes on its own, soonest first, never what's protected", () => {
    const deletions = scheduledDeletions(decode(CandidatePage, "reclaimerr/candidates.json").items)
    // Lost: no rule deletes it on its own. Coco: protected. Brave: canceled.
    expect(deletions.map((d) => [d.fix.title, d.fix.deletion])).toEqual([
      ["Cars 2", { deletesAt: Date.parse("2026-11-18T03:00:00Z") / 1000, operation: "move" }],
      ["Up", { deletesAt: Date.parse("2026-11-24T03:00:00Z") / 1000, operation: "delete" }]
    ])
    expect(deletions[1]!.fix).toMatchObject({ id: "deletion-42", reason: "Unwatched for a year · Last watched more than 365 days ago", actions: ["keep", "dismiss"] })
    expect(deletions.every((d) => d.fix.posterUrl === undefined)).toBe(true)
  })

  it("scheduled deletion: the poster of the Radarr movie it is, by TMDB id, else by title and year", () => {
    const candidates = decode(CandidatePage, "reclaimerr/candidates.json").items
    const movies = Schema.decodeUnknownSync(RadarrMovies)(moviesWithCandidates())
    const deletions = scheduledDeletions(candidates, { movies })
    // Up: same TMDB id. Cars 2: Radarr has another TMDB id for it, its title and year match.
    expect(deletions.map((d) => [d.fix.id, d.fix.posterUrl])).toEqual([["deletion-43", carsPoster], ["deletion-42", upPoster]])
  })

  it("scheduled deletion: no poster when the title can't be told apart", () => {
    const [up] = decode(CandidatePage, "reclaimerr/candidates.json").items
    const movies = Schema.decodeUnknownSync(RadarrMovies)(moviesWithCandidates())
    const unknownId = { ...up!, tmdb_id: null }
    expect(candidatePoster(unknownId, { movies })).toBe(upPoster)
    // Another year, or two movies of that name: not this one.
    expect(candidatePoster({ ...unknownId, year: 1980 }, { movies })).toBeUndefined()
    const twice = Schema.decodeUnknownSync(RadarrMovies)([...moviesWithCandidates(), { ...(moviesWithCandidates().find((m) => (m as { title: string }).title === "Up") as object), id: 999, tmdbId: 1 }])
    expect(candidatePoster(unknownId, { movies: twice })).toBeUndefined()
    // A movie is never matched with a series, and nothing listed means no poster.
    expect(candidatePoster(unknownId, { series: Schema.decodeUnknownSync(SonarrSeries)(fixture("sonarr/series.json")) })).toBeUndefined()
    expect(candidatePoster(up!, {})).toBeUndefined()
  })

  it("scheduled deletion: a series takes its poster from Sonarr, by TMDB id", () => {
    const lost = decode(CandidatePage, "reclaimerr/candidates.json").items.find((c) => c.title === "Lost")!
    const recorded = fixture("sonarr/series.json") as Array<Record<string, unknown>>
    const series = Schema.decodeUnknownSync(SonarrSeries)([
      ...recorded,
      { ...recorded[0], id: 30, title: "LOST", year: 2004, tvdbId: 73739, tmdbId: 2044, images: [{ coverType: "poster", remoteUrl: lostPoster }] }
    ])
    expect(candidatePoster(lost, { series })).toBe(lostPoster)
    expect(candidatePoster({ ...lost, tmdb_id: null }, { series })).toBe(lostPoster)
  })
})

describe("GET /api/fixes", () => {
  it.effect("lists deletions, titles without a source, then blocked imports", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp()
      const list = yield* api.list()
      expect(list.items.map((f) => f.id)).toEqual([
        "deletion-43",
        "deletion-42",
        "missing-season-3-2",
        "missing-movie-48",
        "blocked-radarr-43",
        "blocked-radarr-41",
        "blocked-sonarr-7",
        "blocked-radarr-42"
      ])
      expect(list.unavailable).toEqual([])
      expect(list.hidden).toBe(0)
    }).pipe(Effect.provide(TestApp)))

  it.effect("Reclaimerr's deletions show the poster Radarr has, read once", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ answer: recorded({ "radarr GET /api/v3/movie": () => ({ json: moviesWithCandidates() }) }) })
      const list = yield* api.list()
      expect(list.items.filter((f) => f.kind === "scheduledDeletion").map((f) => [f.id, f.posterUrl])).toEqual([
        ["deletion-43", carsPoster],
        ["deletion-42", upPoster]
      ])
      const paths = home.calls.map((c) => `${c.service} ${c.path.split("?")[0]}`)
      expect(paths.filter((p) => p === "radarr /api/v3/movie")).toHaveLength(1)
      // No series is going to be deleted: Sonarr's series aren't read.
      expect(paths).not.toContain("sonarr /api/v3/series")
    }).pipe(Effect.provide(TestApp)))

  it.effect("without Radarr's library, the deletions still show, without a poster", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ answer: recorded({ "radarr GET /api/v3/movie": { failed: "unreachable" } }) })
      const list = yield* api.list()
      const deletions = list.items.filter((f) => f.kind === "scheduledDeletion")
      expect(deletions.map((f) => f.id)).toEqual(["deletion-43", "deletion-42"])
      expect(deletions.every((f) => f.posterUrl === undefined)).toBe(true)
      expect(list.unavailable).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("Quai Home going offline while Radarr's library is read fails the list", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp()
      expect((yield* Effect.flip(api.list()))._tag).toBe("HomeOffline")
    }).pipe(Effect.provide(testAppDroppingOn("radarr GET /api/v3/movie"))))

  it.effect("a title without a source shows up 2 hours after it was added", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp()
      expect((yield* api.list()).items.map((f) => f.id)).not.toContain("missing-movie-52")
      yield* TestClock.adjust("1 hour")
      expect((yield* api.list()).items.map((f) => f.id)).toContain("missing-movie-52")
    }).pipe(Effect.provide(TestApp)))

  // What isn't reached or doesn't answer is HomeReads' (test/home/reads.test.ts): one smoke test here.
  it.effect("a service that doesn't answer is unavailable; the others still show", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ answer: recorded({ "sonarr GET /api/v3/wanted/missing": { failed: "unreachable" } }) })
      const list = yield* api.list()
      expect(list.unavailable).toEqual(["sonarr"])
      expect(list.items.some((f) => f.service === "sonarr")).toBe(false)
      expect(list.items.some((f) => f.service === "radarr")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("needs the iPhone's token", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp()
      const anonymous = yield* HttpApiTest.groups(QuaiApi, ["fixes"])
      expect(Exit.isFailure(yield* Effect.exit(anonymous.fixes.list()))).toBe(true)
      expect((yield* api.list()).items).toHaveLength(8)
    }).pipe(Effect.provide(TestApp)))
})

describe("snooze and dismiss", () => {
  it.effect("ignore and wait: hidden until a release is grabbed, then forgotten", () =>
    Effect.gen(function*() {
      let grabbed = false
      const { home, api } = yield* setUp({
        answer: recorded({
          "radarr GET /api/v3/history/since": () => ({
            json: [...(fixture("radarr/history-since.json") as Array<unknown>), ...(grabbed ? [{ movieId: 48, date: "2026-11-19T13:00:00Z", eventType: "grabbed" }] : [])]
          })
        })
      })
      yield* api.snooze({ params: { id: "missing-movie-48" }, payload: {} })
      expect(home.documents.get("fixes/snoozed/missing-movie-48")).toEqual({ at: now })
      const hidden = yield* api.list()
      expect(hidden.items.map((f) => f.id)).not.toContain("missing-movie-48")
      expect(hidden.hidden).toBe(1)

      grabbed = true
      yield* TestClock.adjust("1 hour")
      const after = yield* api.list()
      expect(after.hidden).toBe(0)
      expect(home.documents.has("fixes/snoozed/missing-movie-48")).toBe(false)
    }).pipe(Effect.provide(TestApp)))

  it.effect("ignore for some days: back once they're over", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      yield* api.snooze({ params: { id: "missing-season-3-2" }, payload: { days: 3 } })
      expect(home.documents.get("fixes/snoozed/missing-season-3-2")).toEqual({ at: now, until: now + 3 * 86_400_000 })
      yield* TestClock.adjust("2 days")
      expect((yield* api.list()).items.map((f) => f.id)).not.toContain("missing-season-3-2")
      yield* TestClock.adjust("1 day")
      expect((yield* api.list()).items.map((f) => f.id)).toContain("missing-season-3-2")
      expect(home.documents.has("fixes/snoozed/missing-season-3-2")).toBe(false)
    }).pipe(Effect.provide(TestApp)))

  it.effect("a snooze is kept while its service can't be read", () =>
    Effect.gen(function*() {
      let down = false
      const { home, api } = yield* setUp({
        answer: recorded({ "sonarr GET /api/v3/queue": (call) => down ? { failed: "unreachable" } : recorded()(call) })
      })
      yield* api.snooze({ params: { id: "missing-season-3-2" }, payload: {} })
      down = true
      expect((yield* api.list()).unavailable).toEqual(["sonarr"])
      expect(home.documents.has("fixes/snoozed/missing-season-3-2")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("let it go: the deletion is hidden, Reclaimerr isn't told", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      yield* api.dismiss({ params: { id: "deletion-42" } })
      expect(home.documents.get("fixes/dismissed/deletion-42")).toEqual({ at: now })
      expect((yield* api.list()).items.map((f) => f.id)).not.toContain("deletion-42")
      expect(writes(home)).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("an action the problem doesn't offer is refused; an unknown problem is a 404", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      const snoozeDeletion = yield* Effect.flip(api.snooze({ params: { id: "deletion-42" }, payload: {} }))
      expect(snoozeDeletion._tag).toBe("InvalidFix")
      const importDune = yield* Effect.flip(api.import({ params: { id: "blocked-radarr-41" }, payload: { assignments: [] } }))
      expect(importDune._tag).toBe("InvalidFix")
      const gone = yield* Effect.flip(api.keep({ params: { id: "deletion-999" } }))
      expect(gone._tag).toBe("NotFound")
      const nonsense = yield* Effect.flip(api.dismiss({ params: { id: "anything" } }))
      expect(nonsense._tag).toBe("NotFound")
      expect(writes(home)).toEqual([])
      expect(home.documents.size).toBeGreaterThan(0)
      expect([...home.documents.keys()].some((k) => k.startsWith("fixes/"))).toBe(false)
    }).pipe(Effect.provide(TestApp)))
})

describe("fixes", () => {
  it.effect("keep: protects the candidate in Reclaimerr", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      yield* api.keep({ params: { id: "deletion-42" } })
      expect(home.calls.some((c) => c.path.startsWith("/api/v3/movie"))).toBe(false)
      expect(writes(home)).toEqual([{ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: { reason: "Kept from Quai" } }])
    }).pipe(Effect.provide(TestApp)))

  it.effect("remove: out of the queue and the client, blocklisted if asked, never searched again", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      yield* api.remove({ params: { id: "blocked-radarr-41" }, payload: { blocklist: false } })
      yield* api.remove({ params: { id: "blocked-sonarr-7" }, payload: { blocklist: true } })
      expect(writes(home).map((w) => `${w.service} ${w.method} ${w.path}`)).toEqual([
        "radarr DELETE /api/v3/queue/41?removeFromClient=true&blocklist=false&skipRedownload=true",
        "sonarr DELETE /api/v3/queue/7?removeFromClient=true&blocklist=true&skipRedownload=true"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a refusal by the service is a FixFailed in its words", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({
        answer: recorded({ "reclaimerr POST /api/v1/candidates/42/protect": () => ({ status: 409, json: { detail: "A delete or move operation is already pending for this media" } }) })
      })
      const error = yield* Effect.flip(api.keep({ params: { id: "deletion-42" } }))
      expect(error).toMatchObject({ _tag: "FixFailed", message: "A delete or move operation is already pending for this media" })
    }).pipe(Effect.provide(TestApp)))

  it.effect("search releases: Radarr's, accepted first, then by seeders", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      const releases = yield* api.releases({ params: { id: "missing-movie-48" } })
      expect(releases.items.map((r) => [r.title, r.indexer, r.seeders, r.rejected])).toEqual([
        ["Runner.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX", "TorrentLeech", 212, false],
        ["Runner.2026.MULTi.1080p.WEB.H264-SUPPLY", "YggTorrent", 57, false],
        ["Runner.2026.FRENCH.720p.WEB.H264-SLT", "YggTorrent", 4, true]
      ])
      expect(releases.items[1]).toMatchObject({ quality: "WEBDL-1080p", languages: ["English", "French"], sizeBytes: 4831838208, ageHours: 26, customFormatScore: 1500, protocol: "torrent" })
      expect(releases.items[2]!.rejections).toEqual(["Quality WEBDL-720p is not wanted in profile", "Language French is not wanted in profile"])
      expect(home.calls.find((c) => c.path.startsWith("/api/v3/release"))?.path).toBe("/api/v3/release?movieId=48")
    }).pipe(Effect.provide(TestApp)))

  it.effect("search releases: a season's, only those covering nothing but missing episodes", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      const releases = yield* api.releases({ params: { id: "missing-season-3-2" } })
      // The full season pack would replace S02E01–E08's files; the extras map no episode.
      expect(releases.items.map((r) => r.title)).toEqual([
        "Severance.S02E09.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb",
        "Severance.S02E09E10.720p.ATVP.WEB-DL.DDP5.1.H.264-NTb"
      ])
      expect(home.calls.find((c) => c.path.startsWith("/api/v3/release"))?.path).toBe("/api/v3/release?seriesId=3&seasonNumber=2")
    }).pipe(Effect.provide(TestApp)))

  it.effect("grab: sends the release's guid and indexer, only while the title still has no file", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      yield* api.grab({ params: { id: "missing-movie-48" }, payload: { guid: "https://tracker.example/torrent/1003", indexerId: 5 } })
      expect(writes(home)).toEqual([{ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "https://tracker.example/torrent/1003", indexerId: 5 } }])
      // Dune has its file: it's no "no source" problem, so nothing can be grabbed for it.
      const dune = yield* Effect.flip(api.grab({ params: { id: "missing-movie-12" }, payload: { guid: "x", indexerId: 5 } }))
      expect(dune._tag).toBe("NotFound")
      expect(writes(home)).toHaveLength(1)
    }).pipe(Effect.provide(TestApp)))

  it.effect("import anyway (Radarr): the files as matched, quality and languages as read", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      const preview = yield* api.importPreview({ params: { id: "blocked-radarr-42" } })
      expect(preview).toEqual({
        files: [{
          file: "Mouse.2025.MULTi.1080p.WEB.H264-SUPPLY.mkv",
          sizeBytes: 4294967296,
          quality: "WEBDL-1080p",
          episodes: [],
          needsEpisodes: false,
          rejections: ["Found matching movie via grab history, but release was matched to movie by ID. Manual Import required."]
        }],
        episodes: []
      })
      expect(home.calls.find((c) => c.path.startsWith("/api/v3/manualimport"))?.path)
        .toBe("/api/v3/manualimport?downloadId=C3D4E5F60718293A4B5C6D7E8F90123456789012&filterExistingFiles=true")
      yield* api.import({ params: { id: "blocked-radarr-42" }, payload: { assignments: [] } })
      const [command] = writes(home)
      expect(command).toEqual({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: {
          name: "ManualImport",
          importMode: "auto",
          files: [{
            path: "/downloads/complete/Mouse.2025.MULTi.1080p.WEB.H264-SUPPLY/Mouse.2025.MULTi.1080p.WEB.H264-SUPPLY.mkv",
            movieId: 55,
            downloadId: "C3D4E5F60718293A4B5C6D7E8F90123456789012",
            quality: { quality: { id: 3, name: "WEBDL-1080p", source: "webdl", resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } },
            languages: [{ id: 1, name: "English" }, { id: 2, name: "French" }],
            releaseGroup: "SUPPLY",
            indexerFlags: 0
          }]
        }
      })
    }).pipe(Effect.provide(TestApp)))

  it.effect("import anyway (Sonarr): an unmatched file needs its episode, among those without a file", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp()
      const preview = yield* api.importPreview({ params: { id: "blocked-sonarr-7" } })
      expect(preview.files.map((f) => [f.file, f.needsEpisodes])).toEqual([["Amazing.Stories.Pilot.1080p.mkv", true]])
      // S01E02 has its file; the special isn't offered.
      expect(preview.episodes.map((e) => [e.id, e.seasonNumber, e.episodeNumber, e.title])).toEqual([
        [901, 1, 1, "The Cellar"],
        [903, 1, 3, "Dynoman and the Volt!!"]
      ])

      const unchosen = yield* Effect.flip(api.import({ params: { id: "blocked-sonarr-7" }, payload: { assignments: [] } }))
      expect(unchosen).toMatchObject({ _tag: "InvalidFix", message: "Choose the episode for Amazing.Stories.Pilot.1080p.mkv" })
      const taken = yield* Effect.flip(api.import({ params: { id: "blocked-sonarr-7" }, payload: { assignments: [{ file: "Amazing.Stories.Pilot.1080p.mkv", episodeIds: [902] }] } }))
      expect(taken._tag).toBe("InvalidFix")
      expect(writes(home)).toEqual([])

      yield* api.import({ params: { id: "blocked-sonarr-7" }, payload: { assignments: [{ file: "Amazing.Stories.Pilot.1080p.mkv", episodeIds: [901] }] } })
      const [command] = writes(home)
      expect(command!.body).toMatchObject({
        name: "ManualImport",
        importMode: "auto",
        files: [{
          path: "/downloads/complete/Amazing.Stories.2020.S01.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb/Amazing.Stories.Pilot.1080p.mkv",
          seriesId: 9,
          seasonNumber: 1,
          episodeIds: [901],
          downloadId: "0718293A4B5C6D7E8F901234567890123456789A",
          releaseGroup: "NTb"
        }]
      })
      expect(home.calls.find((c) => c.path.startsWith("/api/v3/manualimport"))?.path)
        .toBe("/api/v3/manualimport?downloadId=0718293A4B5C6D7E8F901234567890123456789A&filterExistingFiles=true&seriesId=9")
    }).pipe(Effect.provide(TestApp)))
})

describe("Cleanuparr's planned removals", () => {
  const withCleanuparr = [...services, "cleanuparr"] as const
  const wildRobot = "removal-0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d01"
  const amazingStories = "removal-0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d02"
  const settings = () => fixture("cleanuparr/queue-cleaner.json") as Record<string, unknown>

  it.effect("a download a strike from its limit, still in a queue: the *arr's title, its strikes, Cleanuparr's next run", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services: withCleanuparr })
      const list = yield* api.list()
      const removals = list.items.filter((f) => f.kind === "removalPlanned")
      // Mouse has 1 strike of 3, Dune only dry-run ones, Night of the Living Dead left the queue, Old Movie is removed.
      expect(removals.map((f) => f.id)).toEqual([amazingStories, wildRobot])
      expect(removals[1]).toEqual({
        id: wildRobot,
        kind: "removalPlanned",
        service: "cleanuparr",
        title: "The Wild Robot",
        year: 2024,
        posterUrl: expect.stringMatching(/^https:\/\//),
        reason: "Stalled, no progress",
        since: Date.parse("2026-11-19T11:50:00Z") / 1000,
        actions: ["keep", "dismiss"],
        removal: {
          release: "The.Wild.Robot.2024.1080p.WEB-DL.DDP5.1.H.264-FLUX",
          reason: "stalled",
          strikes: 2,
          maxStrikes: 3,
          removesAt: Date.parse("2026-11-19T12:05:00Z") / 1000
        }
      })
      expect(removals[0]).toMatchObject({ title: expect.stringMatching(/^Amazing Stories/), removal: { reason: "failedImport", strikes: 2, maxStrikes: 3 } })
      // Listed after Reclaimerr's deletions, before the titles without a source.
      expect(list.items.map((f) => f.kind).indexOf("removalPlanned")).toBe(2)
      expect(list.unavailable).toEqual([])
    }).pipe(Effect.provide(TestApp)))

  it.effect("what the queue cleaner leaves alone is not planned", () =>
    Effect.gen(function*() {
      const ignored = yield* setUp({
        services: withCleanuparr,
        answer: recorded({ "cleanuparr GET /api/configuration/queue_cleaner": () => ({ json: { ...settings(), ignoredDownloads: ["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"] } }) })
      })
      expect((yield* ignored.api.list()).items.filter((f) => f.kind === "removalPlanned").map((f) => f.id)).toEqual([amazingStories])
    }).pipe(Effect.provide(TestApp)))

  it.effect("a queue cleaner turned off plans nothing, and the queues aren't read for it", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({
        services: withCleanuparr,
        answer: recorded({ "cleanuparr GET /api/configuration/queue_cleaner": () => ({ json: { ...settings(), enabled: false } }) })
      })
      const list = yield* api.list()
      expect(list.items.some((f) => f.kind === "removalPlanned")).toBe(false)
      expect(home.calls.filter((c) => c.service === "radarr" && c.path.startsWith("/api/v3/queue"))).toHaveLength(1)
    }).pipe(Effect.provide(TestApp)))

  it.effect("Cleanuparr not answering is unavailable; the others still show", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services: withCleanuparr, answer: recorded({ "cleanuparr GET /api/strikes": { status: 401, body: "" } }) })
      const list = yield* api.list()
      expect(list.unavailable).toEqual(["cleanuparr"])
      expect(list.items.some((f) => f.service === "cleanuparr")).toBe(false)
      expect(list.items.some((f) => f.service === "radarr")).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("an older Quai Home doesn't reach Cleanuparr: nothing is asked of it", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ services, protocol: 4 })
      expect((yield* api.list()).items.some((f) => f.service === "cleanuparr")).toBe(false)
      expect(home.calls.some((c) => c.service === "cleanuparr")).toBe(false)
    }).pipe(Effect.provide(TestApp)))

  it.effect("keep: Cleanuparr's queue cleaner leaves the download alone, every other setting as it was", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ services: withCleanuparr })
      yield* api.keep({ params: { id: wildRobot } })
      expect(writes(home)).toEqual([{
        service: "cleanuparr",
        method: "PUT",
        path: "/api/configuration/queue_cleaner",
        body: { ...settings(), ignoredDownloads: ["seeding-keep", "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"] }
      }])
      const journal = yield* Journal
      const { entries } = yield* journal.since(undefined)
      expect(entries.at(-1)).toMatchObject({ source: "cleanuparr", kind: "fix.keep", text: "Kept, Cleanuparr won't remove it: The Wild Robot" })
    }).pipe(Effect.provide(TestApp)))

  it.effect("keep: what Cleanuparr answered goes back as it came, nulls and unknown settings included", () =>
    Effect.gen(function*() {
      const answered = { ...settings(), errored: null, ignoredDownloads: null, aFutureSetting: { on: true } }
      const { home, api } = yield* setUp({ services: withCleanuparr, answer: recorded({ "cleanuparr GET /api/configuration/queue_cleaner": () => ({ json: answered }) }) })
      yield* api.keep({ params: { id: wildRobot } })
      // The fake Quai Home ran the real check against the same answer: it let it through.
      expect(writes(home).map((w) => w.body)).toEqual([{ ...answered, ignoredDownloads: ["A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"] }])
    }).pipe(Effect.provide(TestApp)))

  it.effect("keep: settings changed since they were read are refused by Quai Home, a FixFailed", () =>
    Effect.gen(function*() {
      let reads = 0
      const { home, api } = yield* setUp({
        services: withCleanuparr,
        strict: false,
        answer: recorded({
          // The Cloud reads them twice (to find the problem, then to send them back); then they change.
          "cleanuparr GET /api/configuration/queue_cleaner": () => ({ json: ++reads <= 2 ? settings() : { ...settings(), cronExpression: "0 0 * * * ?" } })
        })
      })
      const error = yield* Effect.flip(api.keep({ params: { id: wildRobot } }))
      expect(error).toMatchObject({ _tag: "FixFailed", message: "Quai Home: not allowed" })
      expect(home.notAllowed).toEqual(["cleanuparr PUT /api/configuration/queue_cleaner"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("let it go: hidden in Quai, Cleanuparr isn't told", () =>
    Effect.gen(function*() {
      const { home, api } = yield* setUp({ services: withCleanuparr })
      yield* api.dismiss({ params: { id: wildRobot } })
      expect(home.documents.get(`fixes/dismissed/${wildRobot}`)).toEqual({ at: now })
      const list = yield* api.list()
      expect(list.items.map((f) => f.id)).not.toContain(wildRobot)
      expect(list.hidden).toBe(1)
      expect(writes(home)).toEqual([])
      const offered = yield* Effect.flip(api.snooze({ params: { id: wildRobot }, payload: {} }))
      expect(offered._tag).toBe("InvalidFix")
    }).pipe(Effect.provide(TestApp)))
})
