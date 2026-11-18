import { Schema } from "effect"
import type { MediaEvent } from "../engine/Events.ts"
import { seriesKey } from "../engine/Events.ts"

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

export const sonarrEvents = (payload: SonarrWebhook): ReadonlyArray<MediaEvent> => {
  const series = payload.series
  if (series === undefined || payload.downloadId === undefined) return []
  const mediaKey = sonarrKey(series.tvdbId, payload.downloadId)
  const title = episodeLabel(series.title, payload.episodes ?? [])
  switch (payload.eventType) {
    case "Grab":
      return [{ _tag: "Grabbed", mediaKey, title, downloadId: payload.downloadId.toLowerCase() }]
    case "Download":
      return [{ _tag: "Imported", mediaKey, title }]
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
