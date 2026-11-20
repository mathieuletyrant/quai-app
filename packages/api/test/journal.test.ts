import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { HomeProtocol, type JournalEntry, journalId, journalPage } from "../src/index.ts"

const entry = (n: number, overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id: journalId(1_000 + n, "c", n),
  at: 1_000 + n,
  level: "info",
  source: "radarr",
  kind: "media.grabbed",
  text: `line ${n}`,
  ...overrides
})

describe("journal ids", () => {
  it("sort as the entries happened, whoever wrote them", () => {
    const ids = [journalId(1_700_000_000_000, "h", 1), journalId(999, "c", 40), journalId(1_700_000_000_000, "c", 2), journalId(1_700_000_000_001, "c", 0)]
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0], ids[3]])
  })
})

describe("journal pages", () => {
  const all = [entry(1), entry(2, { level: "warn", source: "sonarr" }), entry(3, { level: "error", subject: "movie:tmdb:1", title: "Dune" }), entry(4, { source: "apple", deviceName: "Julie's iPhone" })]

  it("are newest first, at most `limit`, and say whether older ones remain", () => {
    const first = journalPage(all, { limit: 3 })
    expect(first.entries.map((e) => e.text)).toEqual(["line 4", "line 3", "line 2"])
    expect(first.more).toBe(true)
    const next = journalPage(all, { limit: 3, before: first.entries.at(-1)!.id })
    expect(next.entries.map((e) => e.text)).toEqual(["line 1"])
    expect(next.more).toBe(false)
  })

  it("filter by sources, by level and up, by title and by words", () => {
    expect(journalPage(all, { limit: 10, sources: ["sonarr", "apple"] }).entries.map((e) => e.text)).toEqual(["line 4", "line 2"])
    expect(journalPage(all, { limit: 10, level: "warn" }).entries.map((e) => e.text)).toEqual(["line 3", "line 2"])
    expect(journalPage(all, { limit: 10, level: "error" }).entries.map((e) => e.text)).toEqual(["line 3"])
    expect(journalPage(all, { limit: 10, subject: "movie:tmdb:1" }).entries.map((e) => e.text)).toEqual(["line 3"])
    expect(journalPage(all, { limit: 10, search: "DUNE" }).entries.map((e) => e.text)).toEqual(["line 3"])
    expect(journalPage(all, { limit: 10, search: "julie" }).entries.map((e) => e.text)).toEqual(["line 4"])
  })

  it("clamp the limit", () => {
    expect(journalPage(all, { limit: 0 }).entries).toHaveLength(1)
  })
})

describe("journal messages", () => {
  it("travel both ways on the home link", () => {
    const cloud = Schema.decodeUnknownSync(HomeProtocol.CloudMessage)
    const home = Schema.decodeUnknownSync(HomeProtocol.HomeMessage)
    expect(cloud({ _tag: "JournalAppend", entries: [entry(1)] })._tag).toBe("JournalAppend")
    expect(cloud({ _tag: "JournalRead", id: "r1", query: { limit: 50, sources: ["radarr"] } })._tag).toBe("JournalRead")
    expect(home({ _tag: "JournalPage", id: "r1", entries: [entry(2)], more: false })._tag).toBe("JournalPage")
    expect(home({ _tag: "JournalNoted", entries: [entry(3, { source: "home" })] })._tag).toBe("JournalNoted")
    expect(() => cloud({ _tag: "JournalAppend", entries: [{ ...entry(1), source: "plex" }] })).toThrow()
  })
})
