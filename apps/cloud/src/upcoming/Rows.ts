import type { UpcomingItem } from "@quai/api"
import type { Detected } from "../fixes/Detected.ts"
import type { SeedCleanup } from "../integrations/cleanuparr.ts"
import { dayOf, instantOf } from "../home/Day.ts"
import type { DayRelease } from "../releases/ReleaseDays.ts"

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
    const episode = episodeRange(releases.flatMap((release) => release.episode === undefined ? [] : [release.episode]))
    const at = first.airsAt ?? instantOf(day, "00:00", zone) / 1000
    return {
      id: `release-${first.id.replace(":", "-")}`,
      kind: "releaseDay",
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

/**
 * When a planned deletion or a stuck removal shows, in epoch seconds: a date already past means the
 * service does it at its next run, so it shows now. Space back orders the same moments with it.
 */
export const dueAt = (atSeconds: number, now: number): number => Math.max(atSeconds, Math.floor(now / 1000))

/** Reclaimerr's planned deletions; one whose date passed goes at its next run, shown now. */
export const plannedDeletionItems = (detected: ReadonlyArray<Detected>, now: number, frees: ReadonlyMap<number, number>): ReadonlyArray<UpcomingItem> =>
  detected.flatMap((found): ReadonlyArray<UpcomingItem> => {
    if (found.fix.deletion === undefined || found.target.kind !== "candidate") return []
    const freesBytes = frees.get(found.target.candidateId)
    return [{
      id: found.fix.id,
      kind: "plannedDeletion",
      service: "reclaimerr",
      title: found.fix.title,
      ...(found.fix.posterUrl === undefined ? {} : { posterUrl: found.fix.posterUrl }),
      at: dueAt(found.fix.deletion.deletesAt, now),
      timed: false,
      earliest: false,
      ...(freesBytes === undefined ? {} : { freesBytes }),
      fixId: found.fix.id
    }]
  })

/** Cleanuparr's stuck removals: at its next queue cleaning, if the download is still stuck then. */
export const stuckRemovalItems = (detected: ReadonlyArray<Detected>, now: number): ReadonlyArray<UpcomingItem> =>
  detected.flatMap((found): ReadonlyArray<UpcomingItem> =>
    found.fix.removal === undefined ? [] : [{
      id: found.fix.id,
      kind: "stuckRemoval",
      service: "cleanuparr",
      title: found.fix.title,
      ...(found.fix.posterUrl === undefined ? {} : { posterUrl: found.fix.posterUrl }),
      // A run Cleanuparr was due for already: the next one, soon.
      at: dueAt(found.fix.removal.removesAt ?? 0, now),
      timed: found.fix.removal.removesAt !== undefined && found.fix.removal.removesAt * 1000 >= now,
      earliest: true,
      fixId: found.fix.id
    }]
  )

/** The Monday of the home's week a day is in ("2026-11-30" for "2026-12-03"). */
export const mondayOf = (day: string): string => {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth))
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
    const dates = members.flatMap((member) => member.at === undefined ? [] : [member.at])
    const freed = members.reduce((sum, member) => sum + (frees.get(member.torrent.hash.toLowerCase()) ?? 0), 0)
    return {
      id: `seed-${week}`,
      kind: "seedCleanup",
      service: "cleanuparr",
      title: torrents(members.length),
      ...(dates.length === 0 ? {} : { at: Math.floor(Math.min(...dates) / 1000), until: Math.floor(Math.max(...dates) / 1000) }),
      timed: false,
      earliest: members.some((member) => member.timing === "from"),
      count: members.length,
      ...(freed > 0 ? { freesBytes: freed } : {})
    }
  })
}

/** By date, a movie (its day's midnight) before the episodes of its day; undated last. */
export const byDate = (left: UpcomingItem, right: UpcomingItem) =>
  (left.at ?? Infinity) - (right.at ?? Infinity) || left.title.localeCompare(right.title)
