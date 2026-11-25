import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import type { Detected } from "../../src/fixes/Detected.ts"
import { DownloadCleanerSettings, type SeedCleanup, type SeedingTorrent } from "../../src/integrations/cleanuparr.ts"
import { plannedDeletionItems, episodeRange, mondayOf, releaseItems, stuckRemovalItems, seedItems } from "../../src/upcoming/Rows.ts"
import type { DayRelease } from "../../src/releases/ReleaseDays.ts"
import { fixture } from "../fixtures.ts"

const paris = "Europe/Paris"
const day = 24 * 3600_000
const now = Date.parse("2026-11-25T10:00:00Z")
const rule = () => Schema.decodeUnknownSync(DownloadCleanerSettings)(fixture("cleanuparr/download-cleaner.json")).clients[0]!.seedingRules[1]!

describe("release rows", () => {
  it("says a run of episodes as one range", () => {
    expect(episodeRange(["S01E08", "S01E07"])).toBe("S01E07–E08")
    expect(episodeRange(["S01E07"])).toBe("S01E07")
    expect(episodeRange(["S02E01", "S01E10"])).toBe("S01E10–S02E01")
    expect(episodeRange([])).toBeUndefined()
  })

  it("keeps what has no file yet: a series' episodes of one day are one row, a movie is a day", () => {
    const episode = (id: number, code: string, airsAt: number, status: DayRelease["status"] = "missing"): DayRelease => ({
      id: `episode:${id}`,
      kind: "episode",
      libraryId: "series:5",
      title: "Severance",
      episode: code,
      airsAt,
      status
    })
    const items = releaseItems([
      { day: "2026-11-26", release: episode(1, "S02E08", 1795600000) },
      // An hour later the same day: still one row, at the first one's time.
      { day: "2026-11-26", release: episode(2, "S02E07", 1795603600) },
      { day: "2026-11-25", release: episode(3, "S02E06", 1795500000, "available") },
      { day: "2026-11-27", release: { id: "movie:9", kind: "movie", libraryId: "movie:9", title: "Dune", status: "grabbed" } }
    ], paris)
    expect(items).toEqual([
      { id: "release-episode-1", kind: "releaseDay", service: "sonarr", title: "Severance", episode: "S02E07–E08", libraryId: "series:5", at: 1795600000, timed: true, earliest: false },
      { id: "release-movie-9", kind: "releaseDay", service: "radarr", title: "Dune", libraryId: "movie:9", at: Date.parse("2026-11-26T23:00:00Z") / 1000, timed: false, earliest: false }
    ])
  })
})

describe("deletion and removal rows", () => {
  const deletion = (deletesAt: number): Detected => ({
    fix: {
      id: "deletion-9",
      kind: "plannedDeletion",
      service: "reclaimerr",
      title: "Runner",
      posterUrl: "https://image.tmdb.org/t/p/original/runner.jpg",
      reason: "Old and unwatched",
      actions: ["keep", "letGo"],
      deletion: { deletesAt, operation: "delete" }
    },
    target: { kind: "candidate", candidateId: 9 }
  })

  it("a deletion is a day, with the space it gives back when known; a past one goes now", () => {
    expect(plannedDeletionItems([deletion(now / 1000 + day / 1000)], now, new Map([[9, 7e9]]))).toEqual([{
      id: "deletion-9",
      kind: "plannedDeletion",
      service: "reclaimerr",
      title: "Runner",
      posterUrl: "https://image.tmdb.org/t/p/original/runner.jpg",
      at: now / 1000 + day / 1000,
      timed: false,
      earliest: false,
      freesBytes: 7e9,
      fixId: "deletion-9"
    }])
    expect(plannedDeletionItems([deletion(now / 1000 - 60)], now, new Map())[0]).toMatchObject({ at: now / 1000 })
    expect(plannedDeletionItems([deletion(now / 1000)], now, new Map())[0]?.freesBytes).toBeUndefined()
  })

  const removal = (removesAt: number | undefined): Detected => ({
    fix: {
      id: "removal-1",
      kind: "stuckRemoval",
      service: "cleanuparr",
      title: "Lost",
      reason: "Stalled, no progress",
      actions: ["letGo"],
      removal: { release: "Lost.S01", reason: "stalled", strikes: 2, maxStrikes: 3, ...(removesAt === undefined ? {} : { removesAt }) }
    },
    target: { kind: "removal", downloadItemId: "1", downloadId: "abc" }
  })

  it("a stuck removal is at the earliest; one whose run is past goes at the next, soon: now, with no time", () => {
    expect(stuckRemovalItems([removal(now / 1000 + 600)], now)[0]).toMatchObject({ at: now / 1000 + 600, timed: true, earliest: true, fixId: "removal-1" })
    expect(stuckRemovalItems([removal(now / 1000 - 600)], now)[0]).toMatchObject({ at: now / 1000, timed: false })
    expect(stuckRemovalItems([removal(undefined)], now)[0]).toMatchObject({ at: now / 1000, timed: false })
  })
})

describe("seed cleanup rows", () => {
  const torrent = (hash: string): SeedingTorrent => ({ hash, name: hash, category: "tv-sonarr", progress: 1, ratio: 0, seeding_time: 0, private: true, state: "uploading" })
  const cleanup = (hash: string, at: number | undefined, overrides: Partial<SeedCleanup> = {}): SeedCleanup =>
    ({ torrent: torrent(hash), rule: rule(), at, timing: "at", atOnce: false, freesFiles: true, ...overrides })

  it("groups them by the home's week, those taken at once left out, the undated last", () => {
    const monday = Date.parse("2026-11-30T09:00:00Z")
    const items = seedItems([
      cleanup("a", monday),
      cleanup("b", monday + 3 * day),
      cleanup("c", monday, { atOnce: true }),
      cleanup("d", undefined)
    ], paris, new Map([["b", 3e9]]))
    expect(items).toEqual([
      {
        id: "seed-2026-11-30",
        kind: "seedCleanup",
        service: "cleanuparr",
        title: "2 torrents",
        at: monday / 1000,
        until: (monday + 3 * day) / 1000,
        timed: false,
        earliest: false,
        count: 2,
        freesBytes: 3e9
      },
      { id: "seed-ratio", kind: "seedCleanup", service: "cleanuparr", title: "1 torrent", timed: false, earliest: false, count: 1 }
    ])
  })

  it("a week is at the earliest when one of its torrents may go later", () => {
    const monday = Date.parse("2026-11-30T09:00:00Z")
    expect(seedItems([cleanup("a", monday), cleanup("b", monday, { timing: "from" })], paris, new Map())[0]?.earliest).toBe(true)
  })

  it("weeks start on Monday", () => {
    expect(mondayOf("2026-12-03")).toBe("2026-11-30")
    expect(mondayOf("2026-11-30")).toBe("2026-11-30")
    expect(mondayOf("2026-12-06")).toBe("2026-11-30")
  })
})
