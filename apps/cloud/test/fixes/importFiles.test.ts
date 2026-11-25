import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { type ImportInput, importFiles } from "../../src/fixes/MediaFixes.ts"
import { type MovieTarget, movies } from "../../src/fixes/movies.ts"
import { series, type SeriesTarget } from "../../src/fixes/series.ts"
import { ManualImportRows } from "../../src/integrations/arr.ts"
import { fixture } from "../fixtures.ts"

const rows = (path: string) => Schema.decodeUnknownSync(ManualImportRows)(fixture(path))
const why = <A>(result: Result.Result<A, { readonly message: string }>) => Result.isFailure(result) ? result.failure.message : "imported"

const movie: ImportInput<MovieTarget> = {
  target: { kind: "movie", _tag: "Queue", queueId: 42, downloadId: "C3D4", movieId: 55 },
  downloadId: "C3D4",
  rows: rows("radarr/manualimport.json"),
  assignments: [],
  choices: []
}

const pilot = "Amazing.Stories.Pilot.1080p.mkv"
const episodes: ImportInput<SeriesTarget> = {
  target: { kind: "series", _tag: "Queue", queueId: 7, downloadId: "0718", seriesId: 9, seasonNumber: undefined },
  downloadId: "0718",
  rows: rows("sonarr/manualimport.json"),
  assignments: [],
  choices: [
    { id: 901, seasonNumber: 1, episodeNumber: 1, title: "The Cellar" },
    { id: 903, seasonNumber: 1, episodeNumber: 3 },
    { id: 1001, seasonNumber: 2, episodeNumber: 1 }
  ]
}

describe("import anyway, decided without a call", () => {
  it("movies: the file as Radarr matched it, never over a file already there", () => {
    const imported = importFiles(movies, movie)
    expect(Result.isSuccess(imported) && imported.success.map((file) => [file.movieId, file.downloadId])).toEqual([[55, "C3D4"]])
    const present = movie.rows.map((row) => ({ ...row, movie: { id: 55, hasFile: true } }))
    expect(why(importFiles(movies, { ...movie, rows: present }))).toBe("This movie already has a file")
    const unknown = { ...movie, target: { ...movie.target, movieId: undefined }, rows: movie.rows.map((row) => ({ ...row, movie: null })) }
    expect(why(importFiles(movies, unknown))).toMatch(/^Radarr doesn't know which movie /)
  })

  it("both: a file that isn't in the download, or no file at all, is refused", () => {
    expect(why(importFiles(movies, { ...movie, assignments: [{ file: "other.mkv", episodeIds: [] }] }))).toBe("other.mkv isn't in this download")
    expect(why(importFiles(series, { ...episodes, assignments: [{ file: "other.mkv", episodeIds: [901] }] }))).toBe("other.mkv isn't in this download")
    expect(why(importFiles(series, { ...episodes, rows: [] }))).toBe("There's no file left to import")
  })

  it("series: an unmatched file takes episodes without a file, all in one season", () => {
    expect(why(importFiles(series, episodes))).toBe(`Choose the episode for ${pilot}`)
    const imported = importFiles(series, { ...episodes, assignments: [{ file: pilot, episodeIds: [901, 903] }] })
    expect(Result.isSuccess(imported) && imported.success.map((file) => [file.seriesId, file.seasonNumber, file.episodeIds])).toEqual([[9, 1, [901, 903]]])
    expect(why(importFiles(series, { ...episodes, assignments: [{ file: pilot, episodeIds: [901, 1001] }] })))
      .toBe(`The episodes chosen for ${pilot} must be in one season`)
    // 902 has its file: it isn't among the choices.
    expect(why(importFiles(series, { ...episodes, assignments: [{ file: pilot, episodeIds: [902] }] })))
      .toBe(`Choose episodes of this series that have no file yet for ${pilot}`)
  })

  it("series: a file Sonarr matched to an episode that has its file is refused", () => {
    const matched = episodes.rows.map((row) => ({ ...row, episodes: [{ id: 902, seasonNumber: 1, episodeNumber: 2, hasFile: true }] }))
    expect(why(importFiles(series, { ...episodes, rows: matched }))).toBe(`${pilot} matches an episode that already has a file`)
    const free = episodes.rows.map((row) => ({ ...row, episodes: [{ id: 903, seasonNumber: 1, episodeNumber: 3, hasFile: false }] }))
    const imported = importFiles(series, { ...episodes, rows: free })
    expect(Result.isSuccess(imported) && imported.success.map((file) => [file.seasonNumber, file.episodeIds])).toEqual([[1, [903]]])
    expect(why(importFiles(series, { ...episodes, target: { ...episodes.target, seriesId: undefined } }))).toBe("Sonarr doesn't know which series this is")
  })
})
