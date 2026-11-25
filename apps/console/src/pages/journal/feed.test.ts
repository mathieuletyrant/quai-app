import { type JournalEntry, journalId } from "@quai/api"
import { describe, expect, it } from "vitest"
import { byDay, historyQuery, noFilters, visibleLines } from "./feed.ts"

const line = (at: number, overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id: journalId(at, "c", 0),
  at,
  level: "info",
  source: "radarr",
  kind: "k",
  text: `at ${at}`,
  ...overrides
})

describe("journal feed", () => {
  const history = [line(30), line(20), line(10)]

  it("puts the live lines newer than the history on top, each once, filtered like the history", () => {
    const live = [line(20), line(40), line(50, { source: "sonarr" }), line(60, { level: "error" })]
    expect(visibleLines(live, history, noFilters, null).lines.map((line) => line.at)).toEqual([60, 50, 40, 30, 20, 10])
    expect(visibleLines(live, history, { ...noFilters, sources: ["radarr"] }, null).lines.map((line) => line.at)).toEqual([60, 40, 30, 20, 10])
    expect(visibleLines(live, history, { ...noFilters, level: "error" }, null).lines.map((line) => line.at)).toEqual([60, 30, 20, 10])
  })

  it("holds back what comes in while paused, and counts it", () => {
    const live = [line(40), line(50)]
    const paused = visibleLines(live, history, noFilters, journalId(40, "c", 0))
    expect(paused.lines.map((line) => line.at)).toEqual([40, 30, 20, 10])
    expect(paused.held).toBe(1)
  })

  it("asks the history route for the filters", () => {
    expect(historyQuery(noFilters)).toEqual({})
    expect(historyQuery({ sources: ["radarr", "apple"], level: "warn", subject: { key: "movie:tmdb:1", title: "Dune" }, search: " dune " }, "x"))
      .toEqual({ before: "x", source: "radarr,apple", level: "warn", subject: "movie:tmdb:1", search: "dune" })
  })

  it("groups by day", () => {
    const now = new Date(2026, 10, 20, 21).getTime()
    const days = byDay([line(now - 3600_000), line(now - 24 * 3600_000), line(now - 3 * 24 * 3600_000)], now)
    expect(days.map((day) => day.label)).toEqual(["Today", "Yesterday", "Tue, Nov 17"])
  })
})
