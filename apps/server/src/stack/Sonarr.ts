import { Schema } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { seriesKey } from "../flows/Events.ts"

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
    mediaType: "series" as const
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

export const sonarrAvailability = (payload: SonarrWebhook) =>
  payload.eventType === "Download" && payload.series !== undefined && payload.downloadId !== undefined
    ? {
      _tag: "Episodes" as const,
      mediaKey: sonarrKey(payload.series.tvdbId, payload.downloadId),
      tvdbId: payload.series.tvdbId,
      title: payload.series.title,
      episodes: (payload.episodes ?? []).map((e) => ({ season: e.seasonNumber, episode: e.episodeNumber }))
    }
    : null
