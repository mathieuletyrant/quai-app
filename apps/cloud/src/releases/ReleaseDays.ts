import { type ActivityItem, defaultStartsAt } from "@quai/api"
import type { Read } from "../home/HomeReads.ts"
import { epochSeconds, posterOf, QueuePage, type QueueRecord } from "../integrations/arr.ts"
import { RadarrCalendar, radarrCalendarPath, radarrCalendarQueuePath, type RadarrCalendarMovie, releasedOn } from "../integrations/radarr.ts"
import { episodeCode, SonarrCalendar, sonarrCalendarPath, sonarrCalendarQueuePath, type SonarrCalendarEpisode } from "../integrations/sonarr.ts"
import { dayOf, dayRange, instantOf, nextDay } from "../home/Day.ts"
import * as LibraryId from "../library/LibraryId.ts"

/**
 * Where a release of the day stands: `available` (its file is there), `downloading` (in the
 * queue, downloading), `grabbed` (in the queue, not downloading yet), `missing` (nothing yet:
 * not aired, or no release found).
 */
export type DayReleaseStatus = "missing" | "grabbed" | "downloading" | "available"

/** One title out on a day: an episode airing (Sonarr) or a movie's digital or physical release (Radarr). */
export interface DayRelease {
  /** `episode:<sonarr id>` or `movie:<radarr id>`. */
  readonly id: string
  readonly kind: "episode" | "movie"
  /** The library title it belongs to: `series:<sonarr id>` for an episode, `movie:<radarr id>`. */
  readonly libraryId: LibraryId.LibraryId
  /** The series' or the movie's title. */
  readonly title: string
  /** "S02E03" */
  readonly episode?: string
  readonly episodeTitle?: string
  /** Epoch seconds it airs at; a movie's release has a day, no time. */
  readonly airsAt?: number
  readonly posterUrl?: string
  readonly status: DayReleaseStatus
}

/** What Radarr and Sonarr said about the day; a list left out wasn't read (yet). */
export interface DayInputs {
  readonly episodes?: ReadonlyArray<SonarrCalendarEpisode> | undefined
  readonly movies?: ReadonlyArray<RadarrCalendarMovie> | undefined
  readonly sonarrQueue?: ReadonlyArray<QueueRecord> | undefined
  readonly radarrQueue?: ReadonlyArray<QueueRecord> | undefined
}

/** The reads of a day: Sonarr's and Radarr's calendars and queues. */
export interface DayReads {
  readonly episodes: Read<typeof SonarrCalendar.Type> & { readonly service: "sonarr" }
  readonly sonarrQueue: Read<typeof QueuePage.Type> & { readonly service: "sonarr" }
  readonly movies: Read<typeof RadarrCalendar.Type> & { readonly service: "radarr" }
  readonly radarrQueue: Read<typeof QueuePage.Type> & { readonly service: "radarr" }
}

/** What one of the day's reads answers. */
export type DayValue<K extends keyof DayReads> = DayReads[K] extends Read<infer A> ? A : never

/**
 * What is read of some days in the home's time zone (`days` from `firstDay`), defined once for the
 * app's Today tile and Upcoming (read when asked) and the day flows (watched).
 */
export const rangeReads = (firstDay: string, days: number, zone: string): DayReads => {
  const { start } = dayRange(firstDay, zone)
  const { end } = dayRange(lastDayOf(firstDay, days), zone)
  // Radarr's dates are days at midnight UTC: a day wider each side, then the home's days are kept.
  const wide = 24 * 3600_000
  return {
    episodes: { service: "sonarr", path: sonarrCalendarPath(start, end), schema: SonarrCalendar },
    sonarrQueue: { service: "sonarr", path: sonarrCalendarQueuePath, schema: QueuePage },
    movies: { service: "radarr", path: radarrCalendarPath(start - wide, end + wide), schema: RadarrCalendar },
    radarrQueue: { service: "radarr", path: radarrCalendarQueuePath, schema: QueuePage }
  }
}

/** What is read of a day. */
export const dayReads = (day: string, zone: string): DayReads => rangeReads(day, 1, zone)

/** The day `days - 1` after `firstDay`. */
const lastDayOf = (firstDay: string, days: number) => {
  let day = firstDay
  for (let index = 1; index < days; index++) day = nextDay(day)
  return day
}

/** What was read of the day (a read left out wasn't), as the releases take it. */
export const dayInputs = (read: { readonly [K in keyof DayReads]?: DayValue<K> | undefined }): DayInputs => ({
  episodes: read.episodes,
  movies: read.movies,
  sonarrQueue: read.sonarrQueue?.records,
  radarrQueue: read.radarrQueue?.records
})

const queued = (queue: ReadonlyArray<QueueRecord> | undefined, matches: (record: QueueRecord) => boolean): DayRelease["status"] | null => {
  const rows = (queue ?? []).filter(matches)
  if (rows.length === 0) return null
  return rows.some((record) => record.status === "downloading") ? "downloading" : "grabbed"
}

/** A release and the home's day it's out on. */
export interface DatedRelease {
  readonly release: DayRelease
  readonly day: string
}

/**
 * The releases of some days (`days` from `firstDay`), in the home's time zone: monitored episodes
 * airing then, monitored movies whose digital or physical release falls on one of the days (the
 * first one). By air time, a movie (a day, no time) after the episodes of its day.
 */
export const rangeReleases = (firstDay: string, days: number, zone: string, inputs: DayInputs): ReadonlyArray<DatedRelease> => {
  const { start } = dayRange(firstDay, zone)
  const { end } = dayRange(lastDayOf(firstDay, days), zone)
  const covered: Array<string> = [firstDay]
  for (let index = 1; index < days; index++) covered.push(nextDay(covered[index - 1]!))
  const episodes = (inputs.episodes ?? []).flatMap((episode): ReadonlyArray<DatedRelease> => {
    const airs = epochSeconds(episode.airDateUtc)
    if (episode.monitored === false || airs === undefined || airs * 1000 < start || airs * 1000 >= end) return []
    const status = episode.hasFile === true ? "available" : queued(inputs.sonarrQueue, (record) => record.episodeId === episode.id) ?? "missing"
    const posterUrl = posterOf(episode.series?.images)
    return [{
      day: dayOf(airs * 1000, zone),
      release: {
        id: `episode:${episode.id}`,
        kind: "episode",
        libraryId: LibraryId.series(episode.seriesId),
        title: episode.series?.title ?? "Unknown series",
        episode: episodeCode(episode.seasonNumber, episode.episodeNumber),
        ...(episode.title === undefined || episode.title === "" || episode.title === "TBA" ? {} : { episodeTitle: episode.title }),
        airsAt: airs,
        ...(posterUrl === undefined ? {} : { posterUrl }),
        status
      }
    }]
  })
  const movies = (inputs.movies ?? []).flatMap((movie): ReadonlyArray<DatedRelease> => {
    const day = movie.monitored === false ? undefined : covered.find((coveredDay) => releasedOn(movie, coveredDay))
    if (day === undefined) return []
    const status = movie.hasFile === true ? "available" : queued(inputs.radarrQueue, (record) => record.movieId === movie.id) ?? "missing"
    const posterUrl = posterOf(movie.images)
    return [{
      day,
      release: {
        id: `movie:${movie.id}`,
        kind: "movie",
        libraryId: LibraryId.movie(movie.id),
        title: movie.title,
        ...(posterUrl === undefined ? {} : { posterUrl }),
        status
      }
    }]
  })
  return [...episodes, ...movies].sort((left, right) =>
    left.day.localeCompare(right.day) ||
    (left.release.airsAt ?? Infinity) - (right.release.airsAt ?? Infinity) ||
    left.release.title.localeCompare(right.release.title) ||
    (left.release.episode ?? "").localeCompare(right.release.episode ?? ""))
}

/**
 * The day's releases, in the home's time zone: monitored episodes airing that day, monitored
 * movies whose digital or physical release is that day. By air time, movies (a day, no time) last.
 */
export const dayReleases = (day: string, zone: string, inputs: DayInputs): ReadonlyArray<DayRelease> =>
  rangeReleases(day, 1, zone, inputs).map((dated) => dated.release)

/** The Live Activity shows this many lines: 4 keep the push far under 4 KB and fit the Lock Screen. */
export const maxItems = 4

const short = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1)}…`

const stateOf = (status: DayRelease["status"]): ActivityItem["state"] =>
  status === "available" ? "done" : status === "missing" ? "waiting" : "active"

/** The lines of the activity: those still awaited first, then those here, at most 4. */
export const activityItems = (releases: ReadonlyArray<DayRelease>): ReadonlyArray<ActivityItem> => {
  const lines = releases.map((release): ActivityItem => ({
    title: short(release.episode === undefined ? release.title : `${release.title} ${release.episode}`, 40),
    ...(release.airsAt === undefined ? {} : { at: release.airsAt }),
    state: stateOf(release.status)
  }))
  return lines.length <= maxItems ? lines : [...lines.filter((line) => line.state !== "done"), ...lines.filter((line) => line.state === "done")].slice(0, maxItems)
}

/** "2 of 5 here" */
export const summary = (releases: ReadonlyArray<DayRelease>) =>
  `${releases.filter((release) => release.status === "available").length} of ${releases.length} here`

export const allAvailable = (releases: ReadonlyArray<DayRelease>) =>
  releases.length > 0 && releases.every((release) => release.status === "available")

/**
 * How much earlier than the flow's time a release airing earlier starts the activity. iOS stops
 * updating a Live Activity after about 8 hours: started at 03:00 for a night of releases, it would
 * be frozen by the evening.
 */
export const earliestStartMs = 3 * 3600_000

/**
 * When the day's activity starts: the flow's time, or the first release's air time if earlier,
 * but never more than 3 hours before the flow's time.
 */
export const startsAt = (day: string, zone: string, time: string | undefined, releases: ReadonlyArray<DayRelease>) => {
  const configured = instantOf(day, time ?? defaultStartsAt, zone)
  const first = Math.min(...releases.flatMap((release) => release.airsAt === undefined ? [] : [release.airsAt * 1000]))
  return Math.max(configured - earliestStartMs, Math.min(configured, first))
}
