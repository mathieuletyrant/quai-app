import type { UpcomingItem } from "@quai/api"
import type { Detected } from "../fixes/Detected.ts"
import type { SeedCleanup } from "../integrations/cleanuparr.ts"
import { dayOf, instantOf } from "../releases/Day.ts"
import type { DayRelease } from "../releases/Today.ts"

/**
 * Upcoming's rows (packages/api `Upcoming.ts`), made from what the services plan. Pure: each
 * function takes what was read, the service puts the rows together.
 */

// Releases: the monitored episodes and movies without a file, by day.

/** "S01E07" and "S01E08" → "S01E07–E08"; another season: "S01E10–S02E01". */
export const episodeRange = (codes: ReadonlyArray<string>): string | undefined => {
  if (codes.length === 0) return undefined
  const sorted = [...codes].sort()
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (first === last) return first
  return first.slice(0, 3) === last.slice(0, 3) ? `${first}–${last.slice(3)}` : `${first}–${last}`
}

/**
 * The releases still to come, as Upcoming rows: a title without its file, an episode at its air
 * time (a series' episodes of one day are one row, at the first one's time), a movie on its day.
 */
export const releaseItems = (dated: ReadonlyArray<{ readonly release: DayRelease; readonly day: string }>, zone: string): ReadonlyArray<UpcomingItem> => {
  const rows = new Map<string, { readonly day: string; readonly releases: Array<DayRelease> }>()
  for (const { release, day } of dated) {
    if (release.status === "available") continue
    const key = release.kind === "episode" ? `${release.libraryId}@${day}` : release.id
    const row = rows.get(key)
    if (row === undefined) rows.set(key, { day, releases: [release] })
    else row.releases.push(release)
  }
  return [...rows.values()].map(({ day, releases }): UpcomingItem => {
    const first = releases[0]!
    const episode = episodeRange(releases.flatMap((r) => r.episode === undefined ? [] : [r.episode]))
    const at = first.airsAt ?? instantOf(day, "00:00", zone) / 1000
    return {
      id: `release-${first.id.replace(":", "-")}`,
      kind: "release",
      service: first.kind === "episode" ? "sonarr" : "radarr",
      title: first.title,
      ...(episode === undefined ? {} : { episode }),
      ...(first.posterUrl === undefined ? {} : { posterUrl: first.posterUrl }),
      libraryId: first.libraryId,
      at,
      timed: first.airsAt !== undefined,
      earliest: false
    }
  })
}

// What goes.

/** Reclaimerr's planned deletions; one whose date passed goes at its next run, shown now. */
export const deletionItems = (detected: ReadonlyArray<Detected>, now: number, frees: ReadonlyMap<number, number>): ReadonlyArray<UpcomingItem> =>
  detected.flatMap((d): ReadonlyArray<UpcomingItem> => {
    if (d.fix.deletion === undefined || d.target.kind !== "candidate") return []
    const freesBytes = frees.get(d.target.candidateId)
    return [{
      id: d.fix.id,
      kind: "deletion",
      service: "reclaimerr",
      title: d.fix.title,
      ...(d.fix.posterUrl === undefined ? {} : { posterUrl: d.fix.posterUrl }),
      at: Math.max(d.fix.deletion.deletesAt, Math.floor(now / 1000)),
      timed: false,
      earliest: false,
      ...(freesBytes === undefined ? {} : { freesBytes }),
      fixId: d.fix.id
    }]
  })

/** Cleanuparr's stuck removals: at its next queue cleaning, if the download is still stuck then. */
export const removalItems = (detected: ReadonlyArray<Detected>, now: number): ReadonlyArray<UpcomingItem> =>
  detected.flatMap((d): ReadonlyArray<UpcomingItem> =>
    d.fix.removal === undefined ? [] : [{
      id: d.fix.id,
      kind: "stuckRemoval",
      service: "cleanuparr",
      title: d.fix.title,
      ...(d.fix.posterUrl === undefined ? {} : { posterUrl: d.fix.posterUrl }),
      // A run Cleanuparr was due for already: the next one, soon.
      at: Math.max(d.fix.removal.removesAt ?? 0, Math.floor(now / 1000)),
      timed: d.fix.removal.removesAt !== undefined && d.fix.removal.removesAt * 1000 >= now,
      earliest: true,
      fixId: d.fix.id
    }]
  )

/** The Monday of the home's week a day is in ("2026-11-30" for "2026-12-03"). */
export const mondayOf = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

const torrents = (count: number) => count === 1 ? "1 torrent" : `${count} torrents`

/**
 * The download cleaner's seed cleanups, one row per week of the home (Monday to Sunday), those it
 * takes at once left out (nothing to plan). Torrents only a ratio takes have no date: one row, last.
 */
export const seedItems = (
  cleanups: ReadonlyArray<SeedCleanup>,
  zone: string,
  frees: ReadonlyMap<string, number>
): ReadonlyArray<UpcomingItem> => {
  const weeks = new Map<string, Array<SeedCleanup>>()
  for (const cleanup of cleanups) {
    if (cleanup.atOnce) continue
    const key = cleanup.at === undefined ? "ratio" : mondayOf(dayOf(cleanup.at, zone))
    weeks.set(key, [...weeks.get(key) ?? [], cleanup])
  }
  return [...weeks].map(([week, members]): UpcomingItem => {
    const dates = members.flatMap((m) => m.at === undefined ? [] : [m.at])
    const freed = members.reduce((sum, m) => sum + (frees.get(m.torrent.hash.toLowerCase()) ?? 0), 0)
    return {
      id: `seed-${week}`,
      kind: "seedCleanup",
      service: "cleanuparr",
      title: torrents(members.length),
      ...(dates.length === 0 ? {} : { at: Math.floor(Math.min(...dates) / 1000), until: Math.floor(Math.max(...dates) / 1000) }),
      timed: false,
      earliest: members.some((m) => m.timing === "from"),
      count: members.length,
      ...(freed > 0 ? { freesBytes: freed } : {})
    }
  })
}

/** By date, a movie (its day's midnight) before the episodes of its day; undated last. */
export const byDate = (a: UpcomingItem, b: UpcomingItem) =>
  (a.at ?? Infinity) - (b.at ?? Infinity) || a.title.localeCompare(b.title)
