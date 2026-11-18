import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeRadarrWebhook, radarrAvailability, radarrEvents } from "../../src/stack/Radarr.ts"
import { decodeSonarrWebhook, episodeLabel, sonarrAvailability, sonarrEvents } from "../../src/stack/Sonarr.ts"
import { fixture } from "../fixtures.ts"

const radarr = (name: string) => decodeRadarrWebhook(fixture(`radarr/${name}.json`))
const sonarr = (name: string) => decodeSonarrWebhook(fixture(`sonarr/${name}.json`))

describe("Radarr webhooks", () => {
  it.effect("MovieAdded starts a search", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarr("movie-added"))).toEqual([
        { _tag: "Added", mediaKey: "movie:tmdb:693134", title: "Dune: Part Two" }
      ])
    }))

  it.effect("Grab carries the torrent hash, lower-cased like qBittorrent's", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarr("grab"))).toEqual([{
        _tag: "Grabbed",
        mediaKey: "movie:tmdb:693134",
        title: "Dune: Part Two",
        downloadId: "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"
      }])
    }))

  it.effect("Download is the import, and asks Jellyfin for the movie", () =>
    Effect.gen(function*() {
      const payload = yield* radarr("download")
      expect(radarrEvents(payload)).toEqual([{ _tag: "Imported", mediaKey: "movie:tmdb:693134", title: "Dune: Part Two" }])
      expect(radarrAvailability(payload)).toEqual({
        _tag: "Movie",
        mediaKey: "movie:tmdb:693134",
        tmdbId: 693134,
        title: "Dune: Part Two"
      })
    }))

  it.effect("the Test button gives nothing", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarr("test"))).toEqual([])
    }))
})

describe("Sonarr webhooks", () => {
  it.effect("one activity per torrent: an episode grab", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarr("grab"))).toEqual([{
        _tag: "Grabbed",
        mediaKey: "series:tvdb:371980:dl:a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        title: "Severance · S02E03",
        downloadId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
      }])
    }))

  it.effect("a multi-episode import asks Jellyfin for each episode", () =>
    Effect.gen(function*() {
      const payload = yield* sonarr("download-season")
      expect(sonarrEvents(payload)).toEqual([{
        _tag: "Imported",
        mediaKey: "series:tvdb:371980:dl:fedcba98765432100123456789abcdef01234567",
        title: "Severance · S02"
      }])
      expect(sonarrAvailability(payload)?.episodes).toEqual([{ season: 2, episode: 1 }, { season: 2, episode: 2 }])
    }))

  it.effect("a series added without a grab starts nothing", () =>
    Effect.gen(function*() {
      expect(sonarrEvents(yield* sonarr("series-add"))).toEqual([])
    }))

  it("labels episodes", () => {
    expect(episodeLabel("Show", [{ seasonNumber: 1, episodeNumber: 2 }, { seasonNumber: 3, episodeNumber: 1 }]))
      .toBe("Show · 2 episodes")
  })
})
