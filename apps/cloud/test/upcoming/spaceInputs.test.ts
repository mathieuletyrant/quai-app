import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { seasonOfRelease } from "../../src/integrations/arr.ts"
import type { SeedCleanup } from "../../src/integrations/cleanuparr.ts"
import type { FinishedTorrent } from "../../src/integrations/qbittorrent.ts"
import { RadarrMovies } from "../../src/integrations/radarr.ts"
import { CandidatePage, candidateTitleKey } from "../../src/integrations/reclaimerr.ts"
import { SonarrSeries } from "../../src/integrations/sonarr.ts"
import { grabKey, grabsByHash, libraryHolds, type SpaceReads, spaceInputs } from "../../src/upcoming/SpaceInputs.ts"
import { grabsSince, maxGrabLookbackMs } from "../../src/upcoming/Upcoming.ts"
import { fixture } from "../fixtures.ts"

const now = Date.parse("2026-11-24T21:00:00Z")
const day = 24 * 3600_000
const candidates = () => Schema.decodeUnknownSync(CandidatePage)(fixture("real/reclaimerr/candidates.json")).items
const runner = () => candidates().find((c) => c.title === "Runner")!
const radarrMovie = (overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(RadarrMovies)([{ id: 55, title: "Runner", year: 2026, tmdbId: 1377237, hasFile: true, sizeOnDisk: 7268360548, ...overrides }])
const finished: FinishedTorrent = {
  hash: "AAA",
  name: "Runner.2026.1080p",
  category: "radarr",
  progress: 1,
  ratio: 0.5,
  seeding_time: 0,
  private: true,
  state: "uploading",
  size: 7e9
}

describe("where a release's files are in the library", () => {
  it("a season when the release names one, the whole series for a pack or none", () => {
    expect(seasonOfRelease("Notre.Maison.2022.S01.INTEGRALE.VFF.1080p")).toBe(1)
    expect(seasonOfRelease("Phony.S01E07.VOSTFR.1080p")).toBe(1)
    expect(seasonOfRelease("Show.S02E05E06.1080p")).toBe(2)
    expect(seasonOfRelease("Show.S01-S03.1080p")).toBeUndefined()
    expect(seasonOfRelease("Show.S01-03.1080p")).toBeUndefined()
    expect(seasonOfRelease("Show.S01.S02.1080p")).toBeUndefined()
    expect(seasonOfRelease("Dune.Part.Two.2024.1080p")).toBeUndefined()
    expect(grabKey({ seriesId: 233, sourceTitle: "Notre.Maison.2022.S01.INTEGRALE" })).toBe("series:233:s1")
    expect(grabKey({ seriesId: 5, sourceTitle: "Show.S01-S03" })).toBe("series:5")
    expect(grabKey({ movieId: 304 })).toBe("movie:304")
  })

  it("each torrent's hash, in lowercase, to its title", () => {
    expect([...grabsByHash({
      radarrGrabs: [{ movieId: 304, date: "2026-11-22T10:59:31Z", downloadId: "D3904AE6" }],
      sonarrGrabs: [{ episodeId: 1, seriesId: 233, date: "2026-11-24T09:33:01Z", downloadId: "A0232", sourceTitle: "Notre.Maison.S01" }, { episodeId: 2, date: "x", downloadId: null }]
    })]).toEqual([["d3904ae6", "movie:304"], ["a0232", "series:233:s1"]])
  })
})

describe("whether the library still holds a title", () => {
  const holds = libraryHolds({
    movies: radarrMovie().concat(radarrMovie({ id: 56, hasFile: false })),
    series: Schema.decodeUnknownSync(SonarrSeries)([{ id: 5, title: "Lost", tvdbId: 1, statistics: { sizeOnDisk: 0 } }])
  })

  it("is gone only when listed with no file: one not listed may have been removed without its files", () => {
    expect(holds("movie:55")).toBe(true)
    expect(holds("movie:56")).toBe(false)
    expect(holds("movie:999")).toBe(true)
    expect(holds("series:5:s1")).toBe(false)
    expect(holds("series:999")).toBe(true)
    expect(libraryHolds({ movies: undefined, series: null })("movie:56")).toBe(true)
  })
})

describe("the title a Reclaimerr deletion takes", () => {
  it("a movie version is the Radarr movie only when it weighs the same", () => {
    expect(candidateTitleKey(runner(), { movies: radarrMovie() })).toBe("movie:55")
    expect(candidateTitleKey(runner(), { movies: radarrMovie({ sizeOnDisk: 2 * 7268360548 }) })).toBeUndefined()
    expect(candidateTitleKey({ ...runner(), scope: "movie" }, { movies: radarrMovie({ sizeOnDisk: 1 }) })).toBe("movie:55")
    expect(candidateTitleKey({ ...runner(), delete_operation: "move" }, { movies: radarrMovie() })).toBeUndefined()
    expect(candidateTitleKey(runner(), {})).toBeUndefined()
  })

  it("a season, or the whole series; an episode is only part of it", () => {
    const vampire = candidates().find((c) => c.media_type === "series")!
    const series = Schema.decodeUnknownSync(SonarrSeries)([{ id: 12, title: "Vampire Diaries", tvdbId: 1, tmdbId: vampire.tmdb_id }])
    expect(candidateTitleKey(vampire, { series })).toBe(`series:12:s${vampire.season_number}`)
    expect(candidateTitleKey({ ...vampire, scope: "series" }, { series })).toBe("series:12")
    expect(candidateTitleKey({ ...vampire, scope: "episode" }, { series })).toBeUndefined()
  })
})

describe("space back's input", () => {
  const reads = (overrides: Partial<SpaceReads> = {}): SpaceReads => ({
    now,
    candidates: [runner()],
    movies: radarrMovie(),
    series: null,
    radarrGrabs: [{ movieId: 55, date: "2026-11-01T00:00:00Z", downloadId: "AAA" }],
    sonarrGrabs: null,
    hardlinks: { movie: true, series: undefined },
    torrents: [finished],
    cleanups: [],
    unlinkedCategory: undefined,
    ...overrides
  })

  it("deletions at their date (now when past), torrents with the cleaner's plan", () => {
    const cleanup = { torrent: finished, at: now + day, timing: "at", freesFiles: true } as unknown as SeedCleanup
    const input = spaceInputs(reads({ cleanups: [cleanup] }))
    expect(input.deletions).toEqual([{ candidateId: 9, key: "movie:55", at: Date.parse("2026-11-30T10:00:05Z"), sizeBytes: 7268360548 }])
    expect(input.torrents).toEqual([{ hash: "AAA", name: "Runner.2026.1080p", size: 7e9, category: "radarr", cleanup: { at: now + day, timing: "at", freesFiles: true } }])
    expect([...input.grabs]).toEqual([["aaa", "movie:55"]])
  })

  it("no qBittorrent reached: no torrent holds anything; reached but silent, or the grabs silent: nothing is sure", () => {
    expect(spaceInputs(reads({ torrents: null })).torrents).toEqual([])
    expect(spaceInputs(reads({ torrents: undefined })).torrents).toBeUndefined()
    expect(spaceInputs(reads({ radarrGrabs: undefined })).torrents).toBeUndefined()
  })

  it("reads the grabs from a day before the oldest torrent, at most 400 days back", () => {
    expect(grabsSince([now / 1000 - 10 * 86400], now)).toBe(now - 11 * day)
    expect(grabsSince([], now)).toBe(now - day)
    expect(grabsSince([0], now)).toBe(now - maxGrabLookbackMs)
  })
})
