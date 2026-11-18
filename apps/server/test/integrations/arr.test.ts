import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeRadarrWebhook, radarr, radarrEvents } from "../../src/integrations/radarr.ts"
import { decodeSonarrWebhook, episodeLabel, sonarr, sonarrEvents } from "../../src/integrations/sonarr.ts"
import { fixture } from "../fixtures.ts"

const radarrPayload = (name: string) => decodeRadarrWebhook(fixture(`radarr/${name}.json`))
const sonarrPayload = (name: string) => decodeSonarrWebhook(fixture(`sonarr/${name}.json`))
const duneLookup = { _tag: "Movie", tmdbId: 693134, title: "Dune: Part Two" }
const severance = (episodes: Array<{ season: number; episode: number }>) => ({ _tag: "Episodes", tvdbId: 371980, title: "Severance", episodes })

describe("Radarr webhooks", () => {
  it.effect("MovieAdded starts a search", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("movie-added"))).toEqual([
        { type: "media.added", subject: { kind: "media", key: "movie:tmdb:693134", title: "Dune: Part Two", mediaType: "movie", lookup: duneLookup } }
      ])
    }))

  it.effect("Grab carries the torrent hash, lower-cased like qBittorrent's", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("grab"))).toEqual([{
        type: "media.grabbed",
        subject: { kind: "media", key: "movie:tmdb:693134", title: "Dune: Part Two", mediaType: "movie", lookup: duneLookup },
        downloadId: "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"
      }])
    }))

  it.effect("Download is the import, with how to find the movie in Jellyfin", () =>
    Effect.gen(function*() {
      expect(radarrEvents(yield* radarrPayload("download"))).toEqual([{
        type: "media.imported",
        subject: { kind: "media", key: "movie:tmdb:693134", title: "Dune: Part Two", mediaType: "movie", lookup: duneLookup }
      }])
    }))

  it.effect("the integration reads a posted body the same way", () =>
    Effect.gen(function*() {
      const events = yield* radarr.webhook!.read(fixture("radarr/grab.json"))
      expect(events.map((e) => e.type)).toEqual(["media.grabbed"])
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
          lookup: severance([{ season: 2, episode: 1 }, { season: 2, episode: 2 }])
        }
      }])
      expect((yield* sonarr.webhook!.read(fixture("sonarr/grab.json"))).map((e) => e.type)).toEqual(["media.grabbed"])
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
