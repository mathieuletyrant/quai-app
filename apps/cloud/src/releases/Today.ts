import { type ActivityItem, type DayRelease, defaultStartsAt } from "@quai/api"
import type { Read } from "../home/HomeReads.ts"
import { epochSeconds, posterOf, QueuePage, type QueueRecord } from "../integrations/arr.ts"
import { RadarrCalendar, radarrCalendarPath, radarrCalendarQueuePath, type RadarrCalendarMovie, releasedOn } from "../integrations/radarr.ts"
import { episodeCode, SonarrCalendar, sonarrCalendarPath, sonarrCalendarQueuePath, type SonarrCalendarEpisode } from "../integrations/sonarr.ts"
import { dayRange, instantOf } from "./Day.ts"

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
 * What is read of a day in the home's time zone, defined once for the app's Today tile (read
 * when asked) and the day flows (watched).
 */
export const dayReads = (day: string, zone: string): DayReads => {
  const { start, end } = dayRange(day, zone)
  // Radarr's dates are days at midnight UTC: a day wider each side, then the home's day is kept.
  const wide = 24 * 3600_000
  return {
    episodes: { service: "sonarr", path: sonarrCalendarPath(start, end), schema: SonarrCalendar },
    sonarrQueue: { service: "sonarr", path: sonarrCalendarQueuePath, schema: QueuePage },
    movies: { service: "radarr", path: radarrCalendarPath(start - wide, end + wide), schema: RadarrCalendar },
    radarrQueue: { service: "radarr", path: radarrCalendarQueuePath, schema: QueuePage }
  }
}

/** What was read of the day (a read left out wasn't), as the releases take it. */
export const dayInputs = (read: { readonly [K in keyof DayReads]?: DayValue<K> | undefined }): DayInputs => ({
  episodes: read.episodes,
  movies: read.movies,
  sonarrQueue: read.sonarrQueue?.records,
  radarrQueue: read.radarrQueue?.records
})

const queued = (queue: ReadonlyArray<QueueRecord> | undefined, matches: (r: QueueRecord) => boolean): DayRelease["status"] | null => {
  const rows = (queue ?? []).filter(matches)
  if (rows.length === 0) return null
  return rows.some((r) => r.status === "downloading") ? "downloading" : "grabbed"
}

/**
 * The day's releases, in the home's time zone: monitored episodes airing that day, monitored
 * movies whose digital or physical release is that day. By air time, movies (a day, no time) last.
 */
export const dayReleases = (day: string, zone: string, inputs: DayInputs): ReadonlyArray<DayRelease> => {
  const { start, end } = dayRange(day, zone)
  const episodes = (inputs.episodes ?? []).flatMap((e): ReadonlyArray<DayRelease> => {
    const airs = epochSeconds(e.airDateUtc)
    if (e.monitored === false || airs === undefined || airs * 1000 < start || airs * 1000 >= end) return []
    const status = e.hasFile === true ? "available" : queued(inputs.sonarrQueue, (r) => r.episodeId === e.id) ?? "missing"
    const posterUrl = posterOf(e.series?.images)
    return [{
      id: `episode:${e.id}`,
      kind: "episode",
      title: e.series?.title ?? "Unknown series",
      episode: episodeCode(e.seasonNumber, e.episodeNumber),
      ...(e.title === undefined || e.title === "" || e.title === "TBA" ? {} : { episodeTitle: e.title }),
      airsAt: airs,
      ...(posterUrl === undefined ? {} : { posterUrl }),
      status
    }]
  })
  const movies = (inputs.movies ?? []).flatMap((m): ReadonlyArray<DayRelease> => {
    if (m.monitored === false || !releasedOn(m, day)) return []
    const status = m.hasFile === true ? "available" : queued(inputs.radarrQueue, (r) => r.movieId === m.id) ?? "missing"
    const posterUrl = posterOf(m.images)
    return [{
      id: `movie:${m.id}`,
      kind: "movie",
      title: m.title,
      ...(posterUrl === undefined ? {} : { posterUrl }),
      status
    }]
  })
  return [...episodes, ...movies].sort((a, b) =>
    (a.airsAt ?? Infinity) - (b.airsAt ?? Infinity) || a.title.localeCompare(b.title) || (a.episode ?? "").localeCompare(b.episode ?? ""))
}

/** The Live Activity shows this many lines: 4 keep the push far under 4 KB and fit the Lock Screen. */
export const maxItems = 4

const short = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1)}…`

const stateOf = (status: DayRelease["status"]): ActivityItem["state"] =>
  status === "available" ? "done" : status === "missing" ? "waiting" : "active"

/** The lines of the activity: those still awaited first, then those here, at most 4. */
export const activityItems = (releases: ReadonlyArray<DayRelease>): ReadonlyArray<ActivityItem> => {
  const lines = releases.map((r): ActivityItem => ({
    title: short(r.episode === undefined ? r.title : `${r.title} ${r.episode}`, 40),
    ...(r.airsAt === undefined ? {} : { at: r.airsAt }),
    state: stateOf(r.status)
  }))
  return lines.length <= maxItems ? lines : [...lines.filter((l) => l.state !== "done"), ...lines.filter((l) => l.state === "done")].slice(0, maxItems)
}

/** "2 of 5 here" */
export const summary = (releases: ReadonlyArray<DayRelease>) =>
  `${releases.filter((r) => r.status === "available").length} of ${releases.length} here`

export const allAvailable = (releases: ReadonlyArray<DayRelease>) =>
  releases.length > 0 && releases.every((r) => r.status === "available")

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
  const first = Math.min(...releases.flatMap((r) => r.airsAt === undefined ? [] : [r.airsAt * 1000]))
  return Math.max(configured - earliestStartMs, Math.min(configured, first))
}
