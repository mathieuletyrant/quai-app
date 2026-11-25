import { describe, expect, it } from "@effect/vitest"
import { spaceBack, type SpaceBackInput, surelyLast, type TorrentInput } from "../../src/upcoming/SpaceBack.ts"

const day = 24 * 3600_000
const T1 = Date.parse("2026-11-30T10:00:00Z")
const T2 = Date.parse("2027-02-12T10:00:00Z")

const movieTorrent = (overrides: Partial<TorrentInput> = {}): TorrentInput => ({
  hash: "aaa",
  name: "Dune.2021.1080p",
  size: 58e9,
  category: "radarr",
  cleanup: { at: T2, timing: "at", freesFiles: true },
  ...overrides
})

const base = (overrides: Partial<SpaceBackInput> = {}): SpaceBackInput => ({
  deletions: [{ candidateId: 9, title: "Dune", key: "movie:1", at: T1, sizeBytes: 57e9 }],
  torrents: [movieTorrent()],
  grabs: new Map([["aaa", "movie:1"]]),
  inLibrary: () => true,
  hardlinks: { movie: true, series: true },
  unlinkedCategory: "cleanuparr-unlinked",
  ...overrides
})

const claims = (input: SpaceBackInput) => {
  const result = spaceBack(input)
  return { deletions: [...result.deletions], torrents: [...result.torrents] }
}
const nothing = { deletions: [], torrents: [] }

describe("the copy that surely goes last", () => {
  it("is the one whose earliest is after every other's latest", () => {
    const exact = (at: number) => ({ row: { torrent: `${at}` }, earliest: at, latest: at })
    expect(surelyLast([exact(1), exact(3)])?.latest).toBe(3)
    // Its ratio may take it sooner than the other: no copy is surely last.
    expect(surelyLast([exact(1), { row: { torrent: "by" }, earliest: -Infinity, latest: 3 }])).toBeUndefined()
    expect(surelyLast([{ row: { torrent: "by" }, earliest: -Infinity, latest: 3 }])?.latest).toBe(3)
    expect(surelyLast([exact(1), { row: { torrent: "never" }, earliest: Infinity, latest: Infinity }])).toBeUndefined()
    expect(surelyLast([])).toBeUndefined()
  })
})

describe("space back, with hardlinks", () => {
  it("a deleted title still seeding comes back when its seed goes, on that row", () => {
    expect(claims(base())).toEqual({ deletions: [], torrents: [["aaa", 58e9]] })
  })

  it("comes back on the deletion when the seed went before, or none held it", () => {
    expect(claims(base({ torrents: [movieTorrent({ cleanup: { at: T1 - day, timing: "at", freesFiles: true } })] })))
      .toEqual({ deletions: [[9, 58e9]], torrents: [] })
    expect(claims(base({ torrents: [] }))).toEqual({ deletions: [[9, 57e9]], torrents: [] })
  })

  it("gives nothing while one copy stays: in the library, or a torrent no rule takes, or that keeps its files", () => {
    expect(claims(base({ deletions: [] }))).toEqual(nothing)
    expect(claims(base({ torrents: [movieTorrent({ cleanup: undefined })] }))).toEqual(nothing)
    expect(claims(base({ torrents: [movieTorrent({ cleanup: { at: T2, timing: "at", freesFiles: false } })] }))).toEqual(nothing)
  })

  it("a seed waiting for seeders or inactivity may never go: nothing", () => {
    const waiting = movieTorrent({ cleanup: { at: T1 - day, timing: "from", freesFiles: true } })
    expect(claims(base({ torrents: [waiting] }))).toEqual(nothing)
  })

  it("a seed a ratio may take sooner: the deletion is surely last only when it's after the latest date", () => {
    const by = (at: number) => movieTorrent({ cleanup: { at, timing: "by", freesFiles: true } })
    expect(claims(base({ torrents: [by(T1 - day)] }))).toEqual({ deletions: [[9, 58e9]], torrents: [] })
    expect(claims(base({ torrents: [by(T2)] }))).toEqual(nothing)
  })

  it("a seed whose title left the library comes back when it goes", () => {
    expect(claims(base({ deletions: [], inLibrary: () => false }))).toEqual({ deletions: [], torrents: [["aaa", 58e9]] })
  })

  it("a cross-seed holds the same files: back when the last of the two goes", () => {
    const cross = movieTorrent({ hash: "bbb", category: "cross-seed-link", cleanup: { at: T2 + day, timing: "at", freesFiles: true } })
    expect(claims(base({ deletions: [], inLibrary: () => false, torrents: [movieTorrent(), cross] }))).toEqual({ deletions: [], torrents: [["bbb", 58e9]] })
    const forever = movieTorrent({ hash: "bbb", category: "cross-seed-link", cleanup: undefined })
    expect(claims(base({ deletions: [], inLibrary: () => false, torrents: [movieTorrent(), forever] }))).toEqual(nothing)
  })

  it("a torrent Quai can't place that may hold the title keeps its deletion from freeing anything", () => {
    // Added by hand, older than the grabs read, or a cross-seed under another name: the same size…
    const sameSize = movieTorrent({ hash: "zzz", name: "Some.Other.Name.MULTi", cleanup: undefined })
    expect(claims(base({ torrents: [sameSize] }))).toEqual(nothing)
    // …or every word of the title in its name.
    const named = movieTorrent({ hash: "zzz", name: "Dune.2021.MULTi.2160p", size: 90e9, cleanup: undefined })
    expect(claims(base({ torrents: [named] }))).toEqual(nothing)
  })

  it("a title that's only a year or a letter still matches by name", () => {
    const year = { candidateId: 10, title: "1917", key: "movie:3", at: T1, sizeBytes: 5e9 }
    const release = movieTorrent({ hash: "zzz", name: "1917.2019.2160p.UHD", size: 30e9, cleanup: undefined })
    expect(claims(base({ deletions: [year], torrents: [release], grabs: new Map() }))).toEqual(nothing)
  })

  it("a torrent Quai can't place that can't hold the title doesn't keep it from freeing", () => {
    const unrelated = movieTorrent({ hash: "zzz", name: "Paddington.in.Peru.2024.1080p", size: 9e9, cleanup: undefined })
    expect(claims(base({ torrents: [unrelated] }))).toEqual({ deletions: [[9, 57e9]], torrents: [] })
  })

  it("a translated title still matches the release by its size", () => {
    const reze = { candidateId: 8, title: "Chainsaw Man – Le Film : L'arc de Reze", key: "movie:2", at: T1, sizeBytes: 5.45e9 }
    const release = movieTorrent({ hash: "zzz", name: "Chainsaw.Man.The.Movie.Reze.Arc.2025.1080p", size: 5.5e9, cleanup: undefined })
    expect(claims(base({ deletions: [reze], torrents: [release], grabs: new Map() }))).toEqual(nothing)
  })

  it("a season pack placed on the whole series holds every season", () => {
    const pack = movieTorrent({ hash: "ppp", name: "Show.S01-S03", category: "tv-sonarr", cleanup: undefined })
    const input = base({
      deletions: [{ candidateId: 7, title: "Show", key: "series:5:s2", at: T1, sizeBytes: 2e10 }],
      torrents: [pack],
      grabs: new Map([["ppp", "series:5"]])
    })
    expect(claims(input)).toEqual(nothing)
  })
})

describe("space back, with copies", () => {
  it("each copy is its own space", () => {
    expect(claims(base({ hardlinks: { movie: false, series: true } }))).toEqual({ deletions: [[9, 57e9]], torrents: [["aaa", 58e9]] })
  })
})

describe("space back says nothing it can't be sure of", () => {
  it("hardlinks unknown, qBittorrent unread", () => {
    expect(claims(base({ hardlinks: { movie: undefined, series: undefined } }))).toEqual(nothing)
    expect(claims(base({ torrents: undefined }))).toEqual(nothing)
  })

  it("a torrent no hardlink holds (Cleanuparr's unlinked category) is its own files, whatever the setting", () => {
    const unlinked = movieTorrent({ hash: "ccc", category: "cleanuparr-unlinked" })
    expect(claims(base({ deletions: [], torrents: [unlinked], grabs: new Map(), hardlinks: { movie: undefined, series: undefined } })))
      .toEqual({ deletions: [], torrents: [["ccc", 58e9]] })
  })

  it("a deletion of an unknown title, or with no size, frees nothing", () => {
    expect(claims(base({ deletions: [{ candidateId: 9, title: "Dune", key: undefined, at: T1, sizeBytes: 57e9 }], torrents: [] }))).toEqual(nothing)
    expect(claims(base({ deletions: [{ candidateId: 9, title: "Dune", key: "movie:1", at: T1, sizeBytes: undefined }], torrents: [] }))).toEqual(nothing)
  })
})
