import { type JournalEntry, journalMatches, type JournalQuery, type JournalSource, journalSourceNames } from "@quai/api"
import type { IconName, Tone } from "../../ui"

/** What the Journal page shows: some sources (none is all), a level and up, a title, words. */
export interface JournalFilters {
  readonly sources: ReadonlyArray<JournalSource>
  readonly level: "info" | "warn" | "error"
  readonly subject: { readonly key: string; readonly title: string } | null
  readonly search: string
}

export const noFilters: JournalFilters = { sources: [], level: "info", subject: null, search: "" }

/** The history route's query for these filters, from `before` on. */
export const historyQuery = (filters: JournalFilters, before?: string) => ({
  ...(before === undefined ? {} : { before }),
  ...(filters.sources.length === 0 ? {} : { source: filters.sources.join(",") }),
  ...(filters.level === "info" ? {} : { level: filters.level }),
  ...(filters.subject === null ? {} : { subject: filters.subject.key }),
  ...(filters.search.trim() === "" ? {} : { search: filters.search.trim() })
})

/** The same filters, as the journal's own matcher reads them, for the lines that come in live. */
const asQuery = (filters: JournalFilters): Omit<JournalQuery, "before" | "limit"> => ({
  sources: filters.sources,
  level: filters.level,
  ...(filters.subject === null ? {} : { subject: filters.subject.key }),
  search: filters.search
})

/**
 * The lines to show: the live ones newer than the history's newest that pass the filters (none past
 * `frozenAt` while paused), then the history pages; newest first, each line once.
 */
export const visibleLines = (
  live: ReadonlyArray<JournalEntry>,
  history: ReadonlyArray<JournalEntry>,
  filters: JournalFilters,
  frozenAt: string | null
) => {
  const newest = history[0]?.id ?? ""
  const query = asQuery(filters)
  const seen = new Set<string>()
  const fresh: Array<JournalEntry> = []
  let held = 0
  for (const entry of live) {
    if (entry.id <= newest || !journalMatches(entry, query)) continue
    if (frozenAt !== null && entry.id > frozenAt) {
      held++
      continue
    }
    fresh.push(entry)
  }
  const lines = [...fresh, ...history]
    .sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
  return { lines, held }
}

const dayMs = 24 * 3600_000
const startOfDay = (at: number) => {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday", "Wed, Nov 18", in the browser's time zone. */
export const dayLabel = (at: number, now: number) => {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / dayMs)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

/** "21:05:12". */
export const timeLabel = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/** Lines grouped by day, in the order they come. */
export const byDay = (lines: ReadonlyArray<JournalEntry>, now: number) => {
  const days: Array<{ label: string; lines: Array<JournalEntry> }> = []
  for (const line of lines) {
    const label = dayLabel(line.at, now)
    const last = days.at(-1)
    if (last?.label === label) last.lines.push(line)
    else days.push({ label, lines: [line] })
  }
  return days
}

export const levelTone: Record<JournalEntry["level"], Tone> = { info: "neutral", warn: "warn", error: "danger" }

export const sourceIcon: Record<JournalSource, IconName> = {
  radarr: "film",
  sonarr: "tv",
  qbittorrent: "download",
  jellyfin: "play",
  seerr: "person",
  reclaimerr: "trash",
  cleanuparr: "broom",
  apple: "phone",
  home: "home",
  cloud: "cloud"
}

export const sourceName = (source: JournalSource) => journalSourceNames[source]

/** "All sources", "Radarr", "Radarr, Sonarr", "4 sources". */
export const sourcesLabel = (sources: ReadonlyArray<JournalSource>) =>
  sources.length === 0 ? "All sources" : sources.length <= 2 ? sources.map(sourceName).join(", ") : `${sources.length} sources`

/** "12 new lines". */
export const heldLabel = (held: number) => `${held} new line${held === 1 ? "" : "s"}`
