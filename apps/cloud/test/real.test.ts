/**
 * Quai on responses recorded from a real home (fixtures/real, fixtures/jellyfin): Radarr 7.0.3,
 * Sonarr 4.0.20, Prowlarr 3.1, Seerr 3.5.2, qBittorrent 5.3.1, Jellyfin 12.4, Cleanuparr and
 * Reclaimerr 0.6.17, on the evening of 2026-11-24. Users anonymized, tracker URLs and indexer names
 * replaced, lists cut to a few entries; everything else as the services answered.
 *
 * The thread through them: "Our House (2022)", a season pack Sonarr grabbed, qBittorrent
 * downloaded, Sonarr imported by hand, and Jellyfin named "Notre maison".
 */
import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { moviesWithoutSource } from "../src/fixes/movies.ts"
import { episodesWithoutSource } from "../src/fixes/series.ts"
import {
  queueCleanerJobRead,
  removalsRead,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead
} from "../src/integrations/cleanuparr.ts"
import {
  EpisodesResult,
  hasEpisodes,
  ItemsResult,
  libraryUser,
  matchItem,
  Users
} from "../src/integrations/jellyfin.ts"
import { progressEvent, Torrents } from "../src/integrations/qbittorrent.ts"
import { libraryMovie, RadarrCalendar, RadarrGrabs, RadarrMissing, RadarrMovies } from "../src/integrations/radarr.ts"
import { candidatesRead, plannedDeletionFixes, plannedDeletions } from "../src/integrations/reclaimerr.ts"
import {
  searchResults,
  seasonChoices,
  SeerrRequest,
  SeerrRequestPage,
  SeerrSearchPage,
  SeerrSeries,
  SeerrTitle,
  SeerrUserPage,
  seerrUsers,
  toMediaRequest
} from "../src/integrations/seerr.ts"
import {
  librarySeries,
  SonarrCalendar,
  SonarrEpisodes,
  SonarrGrabs,
  SonarrMissing,
  SonarrSeries
} from "../src/integrations/sonarr.ts"
import { dayReleases } from "../src/releases/ReleaseDays.ts"
import { DiskSpaces, mediaDisks } from "../src/storage/MediaDisks.ts"
import { fixture } from "./fixtures.ts"

const real = <A, I>(schema: Schema.Codec<A, I>, path: string) =>
  Schema.decodeUnknownSync(schema)(fixture(`${path}.json`))

/** 2026-11-24 22:00 in Paris, when they were recorded. */
const now = Date.parse("2026-11-24T21:00:00Z")

describe("recorded responses", () => {
  it("each one decodes with the schema Quai reads it with", () => {
    const reads: ReadonlyArray<readonly [string, Schema.Codec<unknown, unknown>]> = [
      ["real/radarr/movies", RadarrMovies],
      ["real/radarr/calendar", RadarrCalendar],
      ["real/radarr/wanted-missing", RadarrMissing],
      ["real/radarr/history-since", RadarrGrabs],
      ["real/radarr/diskspace", DiskSpaces],
      ["real/sonarr/series", SonarrSeries],
      ["real/sonarr/calendar", SonarrCalendar],
      ["real/sonarr/wanted-missing", SonarrMissing],
      ["real/sonarr/history-since", SonarrGrabs],
      ["real/sonarr/episodes", SonarrEpisodes],
      ["real/seerr/requests-pending", SeerrRequestPage],
      ["real/seerr/request", SeerrRequest],
      ["real/seerr/search-our-house", SeerrSearchPage],
      ["real/seerr/tv-our-house", SeerrSeries],
      ["real/seerr/movie-hershey", SeerrTitle],
      ["real/seerr/users", SeerrUserPage],
      ["real/qbittorrent/torrents-info", Torrents],
      ["real/reclaimerr/candidates", candidatesRead.schema],
      ["real/cleanuparr/strikes", strikesRead.schema],
      ["real/cleanuparr/queue-cleaner", settingsRead.schema],
      ["real/cleanuparr/stall-rules", stallRulesRead.schema],
      ["real/cleanuparr/slow-rules", slowRulesRead.schema],
      ["real/cleanuparr/job-queue-cleaner", queueCleanerJobRead.schema],
      ["real/cleanuparr/events-removed", removalsRead.schema],
      ["jellyfin/users", Users],
      ["jellyfin/latest-series", ItemsResult],
      ["jellyfin/latest-series-no-user", ItemsResult],
      ["jellyfin/latest-movies", ItemsResult],
      ["jellyfin/episodes-notre-maison", EpisodesResult]
    ] as never
    for (const [path, schema] of reads) {
      expect(() => real(schema, path), path).not.toThrow()
    }
  })
})

describe("one title through every service, by its ids", () => {
  const series = real(SonarrSeries, "real/sonarr/series")
  const ourHouse = series.find((show) => show.id === 233)!

  it("Sonarr knows it by TVDB and IMDb, not TMDB (0): the library item carries what Sonarr knows", () => {
    expect(ourHouse).toMatchObject({ title: "Our House (2022)", tvdbId: 407046, tmdbId: 0 })
    const item = librarySeries(ourHouse)
    expect(item).toMatchObject({
      id: "series:233",
      tvdbId: 407046,
      status: "available",
      episodes: { have: 4, total: 4 }
    })
    expect(item.tmdbId).toBeUndefined()
  })

  it("Seerr finds it as \"Notre maison\" with its TMDB and TVDB ids: the app links the two by TVDB", () => {
    const results = searchResults(real(SeerrSearchPage, "real/seerr/search-our-house"))
    expect(results.map((result) => [result.title, result.year, result.tmdbId, result.tvdbId, result.state])).toEqual([
      ["Our House", 1986, 10625, undefined, "requestable"],
      ["Our House", 1960, 29516, undefined, "requestable"],
      ["Notre maison", 2022, 157014, 407046, "available"]
    ])
    // The namesakes share the name, not the id.
    expect(results.filter((result) => result.tvdbId === librarySeries(ourHouse).tvdbId).map((result) => result.tmdbId))
      .toEqual([157014])
    expect(seasonChoices(real(SeerrSeries, "real/seerr/tv-our-house"))).toEqual([{
      number: 1,
      episodes: 4,
      state: "available"
    }])
  })

  it("the grab's download id is qBittorrent's torrent hash, in another case", () => {
    // As Sonarr answered (Quai's schema keeps only what fixes read): S01E01 and S01E02 of the pack.
    const grabs =
      (fixture("real/sonarr/history-since.json") as ReadonlyArray<{ episodeId: number; downloadId: string }>)
        .filter((grab) => grab.episodeId === 6493 || grab.episodeId === 6494)
    expect(grabs).toHaveLength(2)
    // A season pack: one grab per episode, the same download.
    expect(new Set(grabs.map((grab) => grab.downloadId)).size).toBe(1)
    const hash = grabs[0]!.downloadId.toLowerCase()
    const torrents = real(Torrents, "real/qbittorrent/torrents-info")
    // The torrent's name isn't the release Sonarr grabbed: only the hash links them.
    const torrent = torrents.find((entry) => entry.hash === hash)
    expect(torrent).toBeDefined()
    expect(progressEvent(torrent!)).toEqual({
      type: "download.progress",
      downloadId: hash,
      values: { progress: 1, bytesPerSecond: 0 }
    })
  })

  it("Jellyfin lists it as the administrator only, by its ids, with its four episodes on disk", () => {
    const lookup = {
      _tag: "Episodes" as const,
      tvdbId: ourHouse.tvdbId,
      imdbId: "tt10098728",
      title: ourHouse.title,
      episodes: [1, 2, 3, 4].map((episode) => ({ season: 1, episode }))
    }
    expect(libraryUser(real(Users, "jellyfin/users"))).toBe("5f2b9c1e8a7d4f3b9e6c0a1d2b3c4e5f")
    expect(matchItem(real(ItemsResult, "jellyfin/latest-series-no-user"), lookup)).toBeNull()
    expect(matchItem(real(ItemsResult, "jellyfin/latest-series"), lookup)).toBe("1d44f2954a4209050a6e45617780e347")
    expect(hasEpisodes(real(EpisodesResult, "jellyfin/episodes-notre-maison"), lookup)).toBe(true)
    // Sonarr's episodes are the same four.
    expect(real(SonarrEpisodes, "real/sonarr/episodes").map((episode) => [episode.seasonNumber, episode.episodeNumber]))
      .toEqual([[1, 1], [1, 2], [1, 3], [1, 4]])
  })
})

describe("the library", () => {
  it("reads each movie where it stands: on disk, wanted, or announced", () => {
    const movies = real(RadarrMovies, "real/radarr/movies").map((movie) => libraryMovie(movie))
    expect(movies.map((item) => [item.title, item.status, item.tmdbId])).toEqual([
      ["28 Jours plus tard", "available", 170],
      ["Hershey", "wanted", 1461490],
      ["Avengers : Doomsday", "notAvailable", 1003596]
    ])
    // The public poster, never Radarr's own (key-bound) URL.
    expect(movies.every((item) => item.posterUrl?.startsWith("https://image.tmdb.org/") === true)).toBe(true)
  })

  it("reads each series with Sonarr's own count, and the media disk", () => {
    const series = real(SonarrSeries, "real/sonarr/series").map((show) => librarySeries(show))
    expect(series.map((item) => [item.title, item.status, item.episodes])).toEqual([
      ["Our House (2022)", "available", { have: 4, total: 4 }],
      ["Harlan Coben's Lazarus", "available", { have: 6, total: 6 }],
      // Seasons 1 to 3 aren't monitored: only the missing aired episode of season 4 counts.
      ["Tracker (2024)", "wanted", { have: 6, total: 7 }]
    ])
    // One disk, seen three times (`/`, `/config`, `/downloads`), by Radarr and Sonarr alike.
    const mounts = real(DiskSpaces, "real/radarr/diskspace")
    expect(mediaDisks([{ service: "radarr", mounts }, { service: "sonarr", mounts }])).toEqual([{
      id: "d1963188352000",
      name: "Movies · Shows",
      holds: ["movies", "shows"],
      freeBytes: 786623759360,
      totalBytes: 1963188352000
    }])
  })
})

describe("today's releases", () => {
  const inputs = {
    episodes: real(SonarrCalendar, "real/sonarr/calendar"),
    movies: real(RadarrCalendar, "real/radarr/calendar"),
    sonarrQueue: [],
    radarrQueue: []
  }

  it("on the 24th in Paris: the episode already here, the movie out today and still missing", () => {
    expect(
      dayReleases("2026-11-24", "Europe/Paris", inputs).map((
        release
      ) => [release.id, release.title, release.episode, release.status])
    ).toEqual([
      ["episode:6415", "Phony", "S01E07", "available"],
      ["movie:285", "Warrior Kid", undefined, "missing"]
    ])
  })

  it("on the 25th: two episodes still to come, a title \"TBA\" left out", () => {
    const releases = dayReleases("2026-11-25", "Europe/Paris", inputs)
    expect(releases.map((release) => [release.id, release.episode, release.status])).toEqual([
      ["episode:5204", "S03E07", "missing"],
      ["episode:5205", "S03E08", "missing"]
    ])
    expect(releases.every((release) => release.episodeTitle === undefined)).toBe(true)
  })
})

describe("to fix", () => {
  it("movies out with no release grabbed since; the announced one isn't due yet", () => {
    const missing = real(RadarrMissing, "real/radarr/wanted-missing").records
    const fixes = moviesWithoutSource(missing, [], real(RadarrGrabs, "real/radarr/history-since"), now)
    expect(fixes.map((detected) => [detected.fix.id, detected.fix.title, detected.fix.reason])).toEqual([
      ["missing-movie-285", "Warrior Kid", "No release grabbed since it came out"],
      ["missing-movie-232", "Union County", "No release grabbed since it came out"]
    ])
  })

  it("an episode aired two days ago with no release grabbed", () => {
    const fixes = episodesWithoutSource(
      real(SonarrMissing, "real/sonarr/wanted-missing").records,
      [],
      real(SonarrGrabs, "real/sonarr/history-since"),
      now
    )
    expect(fixes.map((detected) => [detected.fix.id, detected.fix.title, detected.fix.reason])).toEqual([[
      "missing-season-105-4",
      "Tracker (2024) · S04E07",
      "No release grabbed since it aired"
    ]])
  })

  it("Reclaimerr's scheduled deletions, soonest first, a movie's poster from Radarr when it has it", () => {
    const deletions = plannedDeletionFixes(
      plannedDeletions(real(candidatesRead.schema, "real/reclaimerr/candidates").items, undefined),
      { movies: real(RadarrMovies, "real/radarr/movies") }
    )
    expect(deletions.map((detected) => [detected.fix.id, detected.fix.title])).toEqual([
      ["deletion-7", "Vampire Diaries S06"],
      ["deletion-8", "Chainsaw Man – Le Film : L'arc de Reze"],
      ["deletion-9", "Runner"]
    ])
  })
})

describe("requests", () => {
  it("the pending request, its requester, and Seerr's users", () => {
    const [request] = real(SeerrRequestPage, "real/seerr/requests-pending").results
    expect(toMediaRequest(request!, undefined)).toMatchObject({
      id: 37,
      kind: "movie",
      requester: "admin",
      seasons: []
    })
    expect(seerrUsers(real(SeerrUserPage, "real/seerr/users"))).toEqual([{ id: 1, name: "guest" }, {
      id: 2,
      name: "admin"
    }])
  })
})
