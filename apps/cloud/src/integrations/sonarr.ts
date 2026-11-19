import type { LibraryItem } from "@quai/api"
import { Effect, Schema } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { seriesKey } from "../flows/Events.ts"
import type { Integration } from "./Integration.ts"
import { ArrImage, epochSeconds, knownYear, posterOf } from "./radarr.ts"

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
  added: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage)),
  statistics: Schema.optional(Schema.Struct({
    episodeFileCount: Schema.optional(Schema.Number),
    episodeCount: Schema.optional(Schema.Number),
    sizeOnDisk: Schema.optional(Schema.Number)
  }))
})
export const SonarrSeries = Schema.Array(LibrarySeries)
export type SonarrSeries = typeof LibrarySeries.Type

/**
 * A series as the library lists it. `episodeCount` is what Sonarr expects (monitored, aired):
 * available once every one of them has a file, wanted while some miss (or none aired yet).
 */
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
    status: (total > 0 ? have >= total : have > 0) ? "available" : "wanted",
    ...(addedAt === undefined ? {} : { addedAt }),
    sizeBytes: series.statistics?.sizeOnDisk ?? 0,
    ...(series.overview === undefined || series.overview === "" ? {} : { overview: series.overview }),
    episodes: { have, total }
  }
}
