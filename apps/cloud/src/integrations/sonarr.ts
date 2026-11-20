import type { LibraryItem } from "@quai/api"
import { Effect, Schema } from "effect"
import type { Detected } from "../fixes/Detected.ts"
import { noSourceAfterMs } from "../fixes/Detected.ts"
import * as FixId from "../fixes/FixId.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { seriesKey } from "../flows/Events.ts"
import { ArrImage, epochSeconds, knownYear, posterOf, type QueueRecord, queueMessages, queuePageSize } from "./arr.ts"
import type { Integration } from "./Integration.ts"

const Series = Schema.Struct({
  title: Schema.String,
  tvdbId: Schema.Number
})

const Episode = Schema.Struct({
  seasonNumber: Schema.Number,
  episodeNumber: Schema.Number
})

/** The Sonarr webhook payload, only the fields Quai reads. */
export const SonarrWebhook = Schema.Struct({
  eventType: Schema.String,
  series: Schema.optional(Series),
  episodes: Schema.optional(Schema.Array(Episode)),
  downloadId: Schema.optional(Schema.String)
})
export type SonarrWebhook = typeof SonarrWebhook.Type

const pad = (n: number) => n.toString().padStart(2, "0")

/** "Severance · S02E03", "Severance · S02" for a season pack, "Severance · 3 episodes" across seasons. */
export const episodeLabel = (series: string, episodes: ReadonlyArray<typeof Episode.Type>) => {
  if (episodes.length === 0) return series
  const seasons = new Set(episodes.map((e) => e.seasonNumber))
  if (episodes.length === 1) {
    const e = episodes[0]!
    return `${series} · S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}`
  }
  if (seasons.size === 1) return `${series} · S${pad(episodes[0]!.seasonNumber)}`
  return `${series} · ${episodes.length} episodes`
}

/**
 * One activity per download for series: a series has many episodes, each grabbed on its own, so
 * the key is the series plus the torrent. A series added without a grab yet starts nothing:
 * there is no single title to follow until Sonarr grabs something.
 */
export const sonarrKey = (tvdbId: number, downloadId: string) => `${seriesKey(tvdbId)}:dl:${downloadId.toLowerCase()}`

export const sonarrEvents = (payload: SonarrWebhook): ReadonlyArray<FlowEvent> => {
  const series = payload.series
  if (series === undefined || payload.downloadId === undefined) return []
  const subject = {
    kind: "media" as const,
    key: sonarrKey(series.tvdbId, payload.downloadId),
    title: episodeLabel(series.title, payload.episodes ?? []),
    mediaType: "series" as const,
    lookup: {
      _tag: "Episodes" as const,
      tvdbId: series.tvdbId,
      title: series.title,
      episodes: (payload.episodes ?? []).map((e) => ({ season: e.seasonNumber, episode: e.episodeNumber }))
    }
  }
  switch (payload.eventType) {
    case "Grab":
      return [{ type: "media.grabbed", subject, downloadId: payload.downloadId.toLowerCase() }]
    case "Download":
      return [{ type: "media.imported", subject }]
    default:
      return []
  }
}

export const decodeSonarrWebhook = Schema.decodeUnknownEffect(SonarrWebhook)

/** Sonarr pushes: grabbed and imported come by webhook. It has no actions yet. */
export const sonarr: Integration = {
  service: "sonarr",
  webhook: { read: (body) => Effect.map(decodeSonarrWebhook(body), sonarrEvents) },
  actions: {}
}

// The library: `GET /api/v3/series`, read once when the app asks.

const LibrarySeries = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tvdbId: Schema.Number,
  tmdbId: Schema.optional(Schema.Number),
  added: Schema.optional(Schema.String),
  monitored: Schema.optional(Schema.Boolean),
  /** The next monitored episode's air date, when one is coming. */
  nextAiring: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage)),
  statistics: Schema.optional(Schema.Struct({
    episodeFileCount: Schema.optional(Schema.Number),
    /** Monitored episodes that aired, plus every episode with a file. */
    episodeCount: Schema.optional(Schema.Number),
    sizeOnDisk: Schema.optional(Schema.Number)
  }))
})
export const SonarrSeries = Schema.Array(LibrarySeries)
export type SonarrSeries = typeof LibrarySeries.Type

/**
 * A series as the library lists it. `episodeCount` is Sonarr's own count: its monitored episodes
 * that aired, plus every episode that has a file (monitored or not), 0 when none.
 * - wanted: the series is monitored, and has no file yet (announced, nothing aired, or episodes
 *   without an air date: Sonarr grabs them when they come) or fewer files than `episodeCount`;
 * - available: otherwise, once some episode has its file, monitored or not;
 * - not monitored: the series isn't monitored, and nothing is on disk.
 * A monitored series whose episodes are all unmonitored can't be told apart from an announced one
 * from these statistics: it shows as wanted.
 */
const seriesStatus = (series: SonarrSeries, have: number, total: number): LibraryItem["status"] => {
  const monitored = series.monitored !== false
  if (monitored && (have === 0 || have < total)) return "wanted"
  return have > 0 ? "available" : "notMonitored"
}

export const librarySeries = (series: SonarrSeries): LibraryItem => {
  const year = knownYear(series.year)
  const posterUrl = posterOf(series.images)
  const addedAt = epochSeconds(series.added)
  const have = Math.trunc(series.statistics?.episodeFileCount ?? 0)
  const total = Math.trunc(series.statistics?.episodeCount ?? 0)
  return {
    id: `series:${series.id}`,
    kind: "series",
    title: series.title,
    ...(year === undefined ? {} : { year }),
    ...(posterUrl === undefined ? {} : { posterUrl }),
    status: seriesStatus(series, have, total),
    ...(addedAt === undefined ? {} : { addedAt }),
    sizeBytes: series.statistics?.sizeOnDisk ?? 0,
    ...(series.overview === undefined || series.overview === "" ? {} : { overview: series.overview }),
    episodes: { have, total }
  }
}

// The To fix list: the queue (blocked imports), the aired episodes still without a file, and the
// grabs that happened for them, read when the list is asked for.

export const sonarrQueuePath =
  `/api/v3/queue?page=1&pageSize=${queuePageSize}&includeUnknownSeriesItems=true&includeSeries=true&includeEpisode=true`

/** Monitored aired episodes without a file, newest first, with their series. */
export const sonarrMissingPath =
  "/api/v3/wanted/missing?page=1&pageSize=1000&monitored=true&includeSeries=true&sortKey=episodes.airDateUtc&sortDirection=descending"

/** Every episode of a series: to choose which one a file is. */
export const episodesPath = (seriesId: number) => `/api/v3/episode?seriesId=${seriesId}`

const MissingEpisode = Schema.Struct({
  id: Schema.Number,
  seriesId: Schema.Number,
  seasonNumber: Schema.Number,
  episodeNumber: Schema.Number,
  airDateUtc: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
  series: Schema.optional(Schema.Struct({
    title: Schema.String,
    year: Schema.optional(Schema.Number),
    added: Schema.optional(Schema.String),
    monitored: Schema.optional(Schema.Boolean),
    images: Schema.optional(Schema.Array(ArrImage))
  }))
})
export type MissingEpisode = typeof MissingEpisode.Type
export const SonarrMissing = Schema.Struct({ records: Schema.Array(MissingEpisode) })

export const SonarrGrabs = Schema.Array(Schema.Struct({
  episodeId: Schema.Number,
  date: Schema.String,
  eventType: Schema.optional(Schema.String)
}))

export const SonarrEpisodes = Schema.Array(Schema.Struct({
  id: Schema.Number,
  seasonNumber: Schema.Number,
  episodeNumber: Schema.Number,
  title: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean)
}))

/** "S02E03" */
export const episodeCode = (season: number, episode: number) => `S${pad(season)}E${pad(episode)}`

/** A finished download Sonarr won't import. Import anyway needs the series: then the episode can be chosen. */
export const blockedEpisodes = (record: QueueRecord): Detected => {
  const messages = queueMessages(record)
  const series = record.series
  const year = knownYear(series?.year)
  const posterUrl = posterOf(series?.images)
  const since = epochSeconds(record.added)
  const seriesId = record.seriesId ?? undefined
  const title = series === undefined
    ? record.title ?? "Unknown download"
    : episodeLabel(series.title, record.episode === undefined ? [] : [record.episode])
  return {
    fix: {
      id: FixId.blocked("sonarr", record.id),
      kind: "importBlocked",
      service: "sonarr",
      title,
      ...(year === undefined ? {} : { year }),
      ...(posterUrl === undefined ? {} : { posterUrl }),
      reason: messages[0] ?? "Waiting for a manual import",
      ...(since === undefined ? {} : { since }),
      actions: seriesId !== undefined && series !== undefined ? ["importAnyway", "remove"] : ["remove"],
      download: {
        release: record.title ?? "",
        messages,
        ...(record.downloadClient ? { downloadClient: record.downloadClient } : {})
      }
    },
    target: {
      _tag: "Queue",
      service: "sonarr",
      queueId: record.id,
      downloadId: record.downloadId ?? undefined,
      movieId: undefined,
      seriesId,
      seasonNumber: record.seasonNumber ?? record.episode?.seasonNumber ?? undefined
    }
  }
}

/**
 * Aired, monitored episodes still without a file, with nothing in the queue and no grab since they
 * aired (or since the series was added, when later), for over 2 hours. Grouped by season: one
 * problem per series and season, searched for together.
 */
export const episodesWithoutSource = (
  missing: ReadonlyArray<MissingEpisode>,
  queue: ReadonlyArray<QueueRecord>,
  grabs: typeof SonarrGrabs.Type,
  nowMs: number
): ReadonlyArray<Detected> => {
  const queued = new Set(queue.flatMap((r) => r.episodeId === undefined || r.episodeId === null ? [] : [r.episodeId]))
  const seasons = new Map<string, { since: number; aired: boolean; episodes: Array<MissingEpisode> }>()
  for (const episode of missing) {
    if (episode.hasFile === true || episode.monitored === false || episode.series === undefined || queued.has(episode.id)) continue
    const aired = epochSeconds(episode.airDateUtc)
    const added = epochSeconds(episode.series.added)
    if (aired === undefined) continue
    const since = added === undefined ? aired : Math.max(added, aired)
    if (nowMs - since * 1000 < noSourceAfterMs) continue
    const grabbed = grabs.some((g) => g.episodeId === episode.id && (g.eventType ?? "grabbed") === "grabbed" && (epochSeconds(g.date) ?? 0) >= since)
    if (grabbed) continue
    const key = `${episode.seriesId}-${episode.seasonNumber}`
    const season = seasons.get(key) ?? { since, aired: since === aired, episodes: [] }
    season.episodes.push(episode)
    if (since < season.since) seasons.set(key, { ...season, since, aired: since === aired })
    else seasons.set(key, season)
  }
  return [...seasons.values()].map(({ since, aired, episodes }): Detected => {
    const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
    const first = sorted[0]!
    const series = first.series!
    const year = knownYear(series.year)
    const posterUrl = posterOf(series.images)
    return {
      fix: {
        id: FixId.missingSeason(first.seriesId, first.seasonNumber),
        kind: "noSource",
        service: "sonarr",
        title: episodeLabel(series.title, sorted),
        ...(year === undefined ? {} : { year }),
        ...(posterUrl === undefined ? {} : { posterUrl }),
        reason: aired ? "No release grabbed since it aired" : "No release grabbed since the series was added",
        since,
        actions: ["searchReleases", "snooze"],
        missing: { episodes: sorted.map((e) => episodeCode(e.seasonNumber, e.episodeNumber)) }
      },
      target: { _tag: "MissingEpisodes", seriesId: first.seriesId, seasonNumber: first.seasonNumber, episodeIds: sorted.map((e) => e.id) }
    }
  })
}

// Tonight's releases: the episodes airing today, `GET /api/v3/calendar` with their series.

/** Monitored episodes airing between two instants (epoch milliseconds), with their series. */
export const sonarrCalendarPath = (startMs: number, endMs: number) =>
  `/api/v3/calendar?start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${encodeURIComponent(new Date(endMs).toISOString())}&unmonitored=false&includeSeries=true`

export const SonarrCalendar = Schema.Array(Schema.Struct({
  id: Schema.Number,
  seriesId: Schema.Number,
  seasonNumber: Schema.Number,
  episodeNumber: Schema.Number,
  title: Schema.optional(Schema.String),
  airDateUtc: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
  series: Schema.optional(Schema.Struct({
    title: Schema.String,
    images: Schema.optional(Schema.Array(ArrImage))
  }))
}))
export type SonarrCalendarEpisode = (typeof SonarrCalendar.Type)[number]

/** The queue's rows, without the series and episodes: which episode, and whether it downloads. */
export const sonarrCalendarQueuePath = `/api/v3/queue?page=1&pageSize=${queuePageSize}`
