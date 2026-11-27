import { describe, expect, it } from "@effect/vitest"
import { Devices } from "@quai/domain/home/Devices.ts"
import { HomeLink } from "@quai/domain/home/HomeLink.ts"
import { HomeReads } from "@quai/domain/home/HomeReads.ts"
import { HomeTime } from "@quai/domain/home/HomeTime.ts"
import { decodeRadarrWebhook, radarr, radarrEvents } from "@quai/domain/integrations/radarr.ts"
import { decodeSonarrWebhook, episodeLabel, sonarr, sonarrEvents } from "@quai/domain/integrations/sonarr.ts"
import { Journal } from "@quai/domain/journal/Journal.ts"
import { DiskReadings } from "@quai/domain/storage/DiskReadings.ts"
import { Effect, Layer } from "effect"
import { makeFakeHome, recordedHome, type Recording, testLink } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"

const link = Layer.mergeAll(HomeReads.layer, DiskReadings.layer).pipe(
  Layer.provideMerge(HomeTime.layer),
  Layer.provideMerge(Devices.layer),
  Layer.provideMerge(HomeLink.documents),
  Layer.provideMerge(Journal.layer),
  Layer.provideMerge(testLink)
)

const radarrPayload = (name: string) => decodeRadarrWebhook(fixture(`radarr/${name}.json`))
const sonarrPayload = (name: string) => decodeSonarrWebhook(fixture(`sonarr/${name}.json`))
const duneLookup = { _tag: "Movie", tmdbId: 693134, imdbId: "tt15239678", title: "Dune: Part Two" }
const severance = (episodes: Array<{ season: number; episode: number }>) => ({
  _tag: "Episodes",
  tvdbId: 371980,
  tmdbId: 95396,
  imdbId: "tt11280740",
  title: "Severance",
  episodes
})

describe("Radarr webhooks", () => {
  it.effect("MovieAdded starts a search", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("movie-added"))).toEqual([
        {
          type: "media.added",
          subject: {
            kind: "media",
            key: "movie:tmdb:693134",
            title: "Dune: Part Two",
            mediaType: "movie",
            lookup: duneLookup
          }
        }
      ])
    }))

  it.effect("Grab carries the torrent hash, lower-cased like qBittorrent's", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("grab"))).toEqual([{
        type: "media.grabbed",
        subject: {
          kind: "media",
          key: "movie:tmdb:693134",
          title: "Dune: Part Two",
          mediaType: "movie",
          lookup: duneLookup
        },
        downloadId: "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"
      }])
    }))

  it.effect("Download is the import, with how to find the movie in Jellyfin", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("download"))).toEqual([{
        type: "media.imported",
        subject: {
          kind: "media",
          key: "movie:tmdb:693134",
          title: "Dune: Part Two",
          mediaType: "movie",
          lookup: duneLookup
        }
      }])
    }))

  it.effect("the integration reads a posted body the same way", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const integration = yield* radarr
      const events = yield* integration.webhook!.read(fixture("radarr/grab.json"))
      expect(events.map((event) => event.type)).toEqual(["media.grabbed"])
      expect(home.calls).toEqual([])
    }).pipe(Effect.provide(link)))

  const added = (movies: Recording) =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ answer: recordedHome({ "radarr GET /api/v3/movie": movies }) })
      yield* home.connect
      const integration = yield* radarr
      const events = yield* integration.webhook!.read(fixture("radarr/movie-added.json"))
      return { types: events.map((event) => event.type), paths: home.calls.map((call) => call.path) }
    }).pipe(Effect.provide(link))

  it.effect("a movie added that Radarr lists \"Missing\" starts a search", () =>
    Effect.gen(function*() {
      const { types, paths } = yield* added("radarr/movie-by-tmdb.json")
      expect(types).toEqual(["media.added"])
      expect(paths).toEqual(["/api/v3/movie?tmdbId=693134"])
    }))

  it.effect("a movie added before it is out (Radarr's \"Not Available\") starts nothing", () =>
    Effect.gen(function*() {
      const announced = (fixture("radarr/movie-by-tmdb.json") as Array<object>).map((movie) => ({
        ...movie,
        status: "announced",
        isAvailable: false
      }))
      expect((yield* added({ json: announced })).types).toEqual([])
    }))

  it.effect("when Radarr can't say, the search starts all the same", () =>
    Effect.gen(function*() {
      expect((yield* added({ status: 500 })).types).toEqual(["media.added"])
    }))

  it.effect("the Test button gives nothing", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("test"))).toEqual([])
    }))
})

describe("Sonarr webhooks", () => {
  it.effect("one activity per torrent: an episode grab", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarrPayload("grab"))).toEqual([{
        type: "media.grabbed",
        subject: {
          kind: "media",
          key: "series:tvdb:371980:dl:a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          title: "Severance · S02E03",
          mediaType: "series",
          lookup: severance([{ season: 2, episode: 3 }])
        },
        downloadId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
      }])
    }))

  it.effect("a multi-episode import carries every episode for Jellyfin to find", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarrPayload("download-season"))).toEqual([{
        type: "media.imported",
        subject: {
          kind: "media",
          key: "series:tvdb:371980:dl:fedcba98765432100123456789abcdef01234567",
          title: "Severance · S02",
          mediaType: "series",
          // This payload has no IMDb id: the lookup carries the ids Sonarr sent.
          lookup: { ...severance([{ season: 2, episode: 1 }, { season: 2, episode: 2 }]), imdbId: undefined }
        }
      }])
      expect((yield* (yield* sonarr).webhook!.read(fixture("sonarr/grab.json"))).map((event) => event.type)).toEqual([
        "media.grabbed"
      ])
    }).pipe(Effect.provide(link)))

  it.effect("an import that needs someone says so on the torrent's activity", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarrPayload("manual-interaction"))).toEqual([{
        type: "media.importBlocked",
        subject: {
          kind: "media",
          key: "series:tvdb:371980:dl:a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          title: "Severance · S02E03",
          mediaType: "series",
          lookup: severance([{ season: 2, episode: 3 }])
        },
        values: { detail: "Import blocked · see To fix" }
      }])
    }))

  it.effect("a series added without a grab starts nothing", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarrPayload("series-add"))).toEqual([])
    }))

  it("labels episodes", () => {
    expect(episodeLabel("Show", [{ seasonNumber: 1, episodeNumber: 2 }, { seasonNumber: 3, episodeNumber: 1 }]))
      .toBe("Show · 2 episodes")
  })
})
