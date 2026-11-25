import {
  type DayRelease,
  HomeOffline,
  HomeProtocol,
  type Upcoming as UpcomingList,
  type UpcomingItem,
  upcomingReleaseDays,
  type UpcomingService
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import type { Detected } from "../fixes/Detected.ts"
import { candidateLibrary, plannedRemovalsRead } from "../fixes/Planned.ts"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { DownloadGrabs, epochSeconds, grabsSincePath, MediaManagement, seasonOfRelease } from "../integrations/arr.ts"
import {
  downloadCleanerJobRead,
  downloadCleanerRead,
  type SeedCleanup,
  seedCleanups,
  unlinkedCategory
} from "../integrations/cleanuparr.ts"
import { candidatesRead } from "../integrations/deletions.ts"
import { type FinishedTorrent, finishedTorrentsRead } from "../integrations/qbittorrent.ts"
import { RadarrMovies } from "../integrations/radarr.ts"
import { type Candidate, candidateTitleKey, deletionCandidates, scheduledDeletions } from "../integrations/reclaimerr.ts"
import { SonarrSeries } from "../integrations/sonarr.ts"
import { dayOf, instantOf } from "../releases/Day.ts"
import { HomeTime } from "../releases/HomeTime.ts"
import { rangeReads, rangeReleases } from "../releases/Today.ts"
import { type DeletionInput, spaceBack, type TitleKey } from "./SpaceBack.ts"

/** A torrent older than this is never looked up in the *arr history. */
const maxGrabLookbackMs = 400 * 24 * 3600_000

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
 * time (a series' episodes airing together are one row), a movie on its day.
 */
export const releaseItems = (dated: ReadonlyArray<{ readonly release: DayRelease; readonly day: string }>, zone: string): ReadonlyArray<UpcomingItem> => {
  const rows = new Map<string, { readonly day: string; readonly releases: Array<DayRelease> }>()
  for (const { release, day } of dated) {
    if (release.status === "available") continue
    const key = release.kind === "episode" ? `${release.libraryId}@${release.airsAt ?? day}` : release.id
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
      earliest: members.some((m) => m.earliest),
      count: members.length,
      ...(freed > 0 ? { freesBytes: freed } : {})
    }
  })
}

/** By date, a movie (its day's midnight) before the episodes of its day; undated last. */
export const byDate = (a: UpcomingItem, b: UpcomingItem) =>
  (a.at ?? Infinity) - (b.at ?? Infinity) || a.title.localeCompare(b.title)

/** The title a grab was for, as space back keys it: a series' season when the release names one. */
export const grabKey = (grab: typeof DownloadGrabs.Type[number]): TitleKey | undefined => {
  if (grab.movieId !== undefined) return `movie:${grab.movieId}`
  if (grab.seriesId === undefined) return undefined
  const season = grab.sourceTitle === undefined ? undefined : seasonOfRelease(grab.sourceTitle)
  return season === undefined ? `series:${grab.seriesId}` : `series:${grab.seriesId}:s${season}`
}

/**
 * Upcoming (docs/upcoming.md): what the stack will do on its own, read when the app asks, nothing
 * kept. Releases from Radarr's and Sonarr's calendars, deletions and stuck removals from the reads
 * that feed the To fix list, seed cleanups from Cleanuparr's download cleaner and qBittorrent, and
 * the space each gives back (SpaceBack.ts) from the *arr history, libraries and settings.
 */
export class Upcoming extends Context.Service<Upcoming, {
  readonly list: Effect.Effect<UpcomingList, HomeOffline>
}>()("quai/Upcoming") {
  static readonly layer = Layer.effect(
    Upcoming,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const link = yield* HomeLink
      const time = yield* HomeTime

      const list = Effect.gen(function*(): Effect.fn.Return<UpcomingList, HomeOffline> {
        const home = yield* link.home
        if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
        const zone = yield* time.zone
        const now = yield* Clock.currentTimeMillis
        const today = dayOf(now, zone)
        const reached = home.value.services
        const has = (service: HomeProtocol.HomeService) => reached.includes(service)
        const recent = home.value.protocol >= HomeProtocol.upcomingProtocolVersion
        const seeding = recent && has("cleanuparr") && has("qbittorrent")
        const none = Effect.succeed(Option.none<never>())

        const calendar = rangeReads(today, upcomingReleaseDays, zone)
        const [calendars, candidates, removals, cleaner, job, finished] = yield* Effect.all([
          reads.all({ episodes: calendar.episodes, movies: calendar.movies }),
          has("reclaimerr") ? reads.read(candidatesRead) : none,
          has("cleanuparr") ? plannedRemovalsRead(reads) : none,
          seeding ? reads.read(downloadCleanerRead) : none,
          seeding ? reads.read(downloadCleanerJobRead) : none,
          seeding ? reads.read(finishedTorrentsRead) : none
        ], { concurrency: "unbounded" })

        const releases = releaseItems(
          rangeReleases(today, upcomingReleaseDays, zone, {
            episodes: Option.getOrUndefined(calendars.values.episodes),
            movies: Option.getOrUndefined(calendars.values.movies)
          }),
          zone
        )

        const nextRunAt = Option.flatMap(job, (j) => Option.fromNullishOr(epochSeconds(j.nextRunTime ?? undefined)))
        const cleanups: ReadonlyArray<SeedCleanup<FinishedTorrent>> = Option.isSome(cleaner) && Option.isSome(finished)
          ? seedCleanups({
            settings: cleaner.value,
            torrents: finished.value,
            nextRunAt: Option.getOrUndefined(Option.map(nextRunAt, (s) => s * 1000)),
            now
          })
          : []

        const planned: ReadonlyArray<Candidate> = Option.match(candidates, { onNone: () => [], onSome: (page) => deletionCandidates(page.items) })
        // Space back needs the libraries, the grabs and the hardlink settings: read only when something goes.
        const spaceWanted = recent && (planned.length > 0 || cleanups.length > 0)
        const oldest = Option.match(finished, {
          onNone: () => now,
          onSome: (list) => Math.min(now, ...list.flatMap((t) => t.added_on === undefined ? [] : [t.added_on * 1000]))
        })
        const since = Math.max(oldest - 24 * 3600_000, now - maxGrabLookbackMs)
        const library = spaceWanted
          ? yield* reads.all({
            movies: has("radarr") ? { service: "radarr", path: "/api/v3/movie", schema: RadarrMovies } : null,
            series: has("sonarr") ? { service: "sonarr", path: "/api/v3/series", schema: SonarrSeries } : null,
            radarrGrabs: has("radarr") ? { service: "radarr", path: grabsSincePath(since), schema: DownloadGrabs } : null,
            sonarrGrabs: has("sonarr") ? { service: "sonarr", path: grabsSincePath(since), schema: DownloadGrabs } : null,
            radarrSettings: has("radarr") ? { service: "radarr", path: "/api/v3/config/mediamanagement", schema: MediaManagement } : null,
            sonarrSettings: has("sonarr") ? { service: "sonarr", path: "/api/v3/config/mediamanagement", schema: MediaManagement } : null
          }, { optional: ["movies", "series", "radarrGrabs", "sonarrGrabs", "radarrSettings", "sonarrSettings"] })
          : undefined
        const movies = library === undefined ? undefined : Option.getOrUndefined(library.values.movies)
        const series = library === undefined ? undefined : Option.getOrUndefined(library.values.series)
        const sources = library === undefined && planned.length > 0 ? yield* candidateLibrary(reads, planned) : { movies, series }
        const deletions = scheduledDeletions(planned, sources)

        const frees = (() => {
          if (library === undefined) return { deletions: new Map<number, number>(), torrents: new Map<string, number>() }
          const grabs = new Map<string, TitleKey>()
          for (const grab of [...Option.getOrElse(library.values.radarrGrabs, () => []), ...Option.getOrElse(library.values.sonarrGrabs, () => [])]) {
            const key = grabKey(grab)
            if (key !== undefined && grab.downloadId) grabs.set(grab.downloadId.toLowerCase(), key)
          }
          // Without the grabs, no torrent can be placed: none can be said to hold a title's files.
          const placeable = Option.isSome(library.values.radarrGrabs) || !has("radarr")
            ? Option.isSome(library.values.sonarrGrabs) || !has("sonarr")
            : false
          const cleanupOf = new Map(cleanups.map((c) => [c.torrent.hash.toLowerCase(), c]))
          const deletionInputs = planned.map((candidate): DeletionInput => ({
            candidateId: candidate.id,
            key: candidateTitleKey(candidate, sources),
            at: Math.max((epochSeconds(candidate.auto_delete_eligible_at) ?? 0) * 1000, now),
            sizeBytes: candidate.size_bytes ?? undefined
          }))
          return spaceBack({
            deletions: deletionInputs,
            torrents: !placeable ? undefined : Option.getOrUndefined(Option.map(finished, (list) =>
              list.map((t) => {
                const cleanup = cleanupOf.get(t.hash.toLowerCase())
                return {
                  hash: t.hash,
                  name: t.name,
                  size: t.size,
                  category: t.category,
                  cleanup: cleanup === undefined ? undefined : { at: cleanup.at, freesFiles: cleanup.freesFiles }
                }
              }))),
            grabs,
            // A library that couldn't be read holds everything: no space can be said to come back.
            inLibrary: (key) => {
              const [kind, id] = key.split(":")
              if (kind === "movie") return movies === undefined || movies.find((m) => m.id === Number(id))?.hasFile === true
              return series === undefined || (series.find((s) => s.id === Number(id))?.statistics?.sizeOnDisk ?? 0) > 0
            },
            hardlinks: {
              movie: Option.getOrUndefined(Option.map(library.values.radarrSettings, (s) => s.copyUsingHardlinks)),
              series: Option.getOrUndefined(Option.map(library.values.sonarrSettings, (s) => s.copyUsingHardlinks))
            },
            unlinkedCategory: Option.getOrUndefined(Option.map(cleaner, unlinkedCategory))
          })
        })()

        const unavailable: Array<UpcomingService> = []
        if (calendars.unavailable.includes("radarr")) unavailable.push("radarr")
        if (calendars.unavailable.includes("sonarr")) unavailable.push("sonarr")
        if (has("reclaimerr") && Option.isNone(candidates)) unavailable.push("reclaimerr")
        if (has("cleanuparr") && (Option.isNone(removals) || (seeding && Option.isNone(cleaner)))) unavailable.push("cleanuparr")
        if (seeding && Option.isNone(finished)) unavailable.push("qbittorrent")

        return {
          timeZone: zone,
          items: [
            ...releases,
            ...deletionItems(deletions, now, frees.deletions),
            ...removalItems(Option.getOrElse(removals, () => []), now),
            ...seedItems(cleanups, zone, frees.torrents)
          ].sort(byDate),
          unavailable,
          homeOutdated: !recent && has("cleanuparr")
        }
      })

      return { list }
    })
  )
}

