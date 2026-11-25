import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import {
  DownloadCleanerSettings,
  type SeedingRule,
  seedingRuleOf,
  type SeedingTorrent,
  seedCleanups,
  unlinkedCategory
} from "../../src/integrations/cleanuparr.ts"
import { fixture } from "../fixtures.ts"

const hour = 3600_000
const now = Date.parse("2026-11-24T21:00:00Z")
const settings = () => Schema.decodeUnknownSync(DownloadCleanerSettings)(fixture("cleanuparr/download-cleaner.json"))
const rules = () => settings().clients[0]!.seedingRules

/** The fixture's rules replaced, for the client Quai reads. */
const withRules = (seedingRules: ReadonlyArray<SeedingRule>) => {
  const base = settings()
  return { ...base, clients: base.clients.map((c) => ({ ...c, seedingRules })) }
}

const torrent = (overrides: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "a023231bf0630af6d783211374ac3d1ac6a8ef36",
  name: "Our.House.S01.1080p",
  category: "tv-sonarr",
  progress: 1,
  ratio: 0.3,
  seeding_time: 0,
  private: true,
  state: "uploading",
  ...overrides
})

const run = (torrents: ReadonlyArray<SeedingTorrent>, overrides: { nextRunAt?: number; settings?: typeof DownloadCleanerSettings.Type } = {}) =>
  seedCleanups({ settings: overrides.settings ?? settings(), torrents, nextRunAt: overrides.nextRunAt, now })

describe("the download cleaner's rule for a torrent", () => {
  it("is the first by priority that covers it", () => {
    expect(seedingRuleOf(rules(), torrent())?.name).toBe("Private: 90 days of seeding")
    expect(seedingRuleOf(rules(), torrent({ private: false }))?.name).toBe("Public: removed at once")
    expect(seedingRuleOf(rules(), torrent({ category: "manual" }))).toBeUndefined()
  })

  it("is unknown when a rule before it may cover it and Quai can't tell: trackers, privacy unknown", () => {
    const [publicRule, privateRule] = rules()
    const catchAll: SeedingRule = { ...privateRule!, name: "Anything: 2 days", privacyType: "Both", maxSeedTime: 48, priority: 9 }
    const byTracker: SeedingRule = { ...privateRule!, name: "Tracker X: forever", trackerPatterns: ["tracker.example"], maxSeedTime: -1, priority: 0 }
    expect(seedingRuleOf([byTracker, catchAll], torrent())).toBeUndefined()
    // qBittorrent before 5 doesn't say whether a torrent is private.
    expect(seedingRuleOf([publicRule!, catchAll], torrent({ private: undefined }))).toBeUndefined()
    expect(seedingRuleOf([catchAll], torrent({ private: undefined }))?.name).toBe("Anything: 2 days")
  })
})

describe("seed cleanups", () => {
  it("take a private torrent once it seeded 90 days, with its files, at that moment", () => {
    const [cleanup] = run([torrent({ seeding_time: 7499 })])
    expect(cleanup?.rule.name).toBe("Private: 90 days of seeding")
    expect(cleanup?.at).toBe(now + (2160 * 3600 - 7499) * 1000)
    expect(cleanup?.timing).toBe("at")
    expect(cleanup?.atOnce).toBe(false)
    expect(cleanup?.freesFiles).toBe(true)
  })

  it("mark what goes at once, and leave alone what no rule covers, what's ignored or not finished", () => {
    expect(run([torrent({ private: false })])[0]?.atOnce).toBe(true)
    expect(run([torrent({ category: "manual" })])).toEqual([])
    expect(run([torrent({ progress: 0.5 })])).toEqual([])
    expect(run([torrent()], { settings: { ...settings(), ignoredDownloads: ["A023231BF0630AF6D783211374AC3D1AC6A8EF36"] } })).toEqual([])
    expect(run([torrent()], { settings: { ...settings(), enabled: false } })).toEqual([])
    expect(run([torrent({ private: undefined })])).toEqual([])
  })

  it("go at the next run once due; with only a ratio, have no date", () => {
    const nextRunAt = now + 2 * hour
    expect(run([torrent({ seeding_time: 2160 * 3600 - 60 })], { nextRunAt })[0]?.at).toBe(nextRunAt)
    const ratioOnly = withRules(rules().map((r) => ({ ...r, maxRatio: 2, maxSeedTime: -1 })))
    expect(run([torrent({ ratio: 1 })], { settings: ratioOnly })[0]?.at).toBeUndefined()
    expect(run([torrent({ ratio: 2.5 })], { settings: ratioOnly, nextRunAt })[0]).toMatchObject({ at: nextRunAt, timing: "at" })
  })

  it("with a ratio too, the seed time is only the latest it goes", () => {
    const both = withRules(rules().map((r) => ({ ...r, maxRatio: 2 })))
    expect(run([torrent({ ratio: 1 })], { settings: both })[0]?.timing).toBe("by")
  })

  it("waiting for seeders or inactivity, the date is only the earliest", () => {
    const waiting = withRules(rules().map((r) => ({ ...r, minSeeders: 5 })))
    expect(run([torrent()], { settings: waiting })[0]?.timing).toBe("from")
    const inactive = withRules(rules().map((r) => ({ ...r, maxInactiveDays: 7 })))
    expect(run([torrent()], { settings: inactive })[0]?.timing).toBe("from")
  })

  it("a stopped torrent gets no closer to its limits: only what's due already goes", () => {
    expect(run([torrent({ state: "stoppedUP", seeding_time: 3600 })])).toEqual([])
    expect(run([torrent({ state: "pausedUP", seeding_time: 2160 * 3600 })])[0]?.at).toBe(now)
    const stop = withRules(rules().map((r) => ({ ...r, action: "Stop" })))
    expect(run([torrent({ state: "stoppedUP", seeding_time: 2160 * 3600 })], { settings: stop })).toEqual([])
    expect(run([torrent()], { settings: stop })[0]?.freesFiles).toBe(false)
  })

  it("know the category of torrents no hardlink holds", () => {
    expect(unlinkedCategory(settings())).toBe("cleanuparr-unlinked")
  })
})
