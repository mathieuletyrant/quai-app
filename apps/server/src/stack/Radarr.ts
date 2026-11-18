import { Schema } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { movieKey } from "../flows/Events.ts"

const Movie = Schema.Struct({
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tmdbId: Schema.Number
})

/** The Radarr webhook payload, only the fields Quai reads. Unknown event types are kept as-is. */
export const RadarrWebhook = Schema.Struct({
  eventType: Schema.String,
  movie: Schema.optional(Movie),
  downloadId: Schema.optional(Schema.String)
})
export type RadarrWebhook = typeof RadarrWebhook.Type

const titleOf = (movie: typeof Movie.Type) => movie.title

/** Radarr's events in the catalog's terms. Events Quai doesn't follow give nothing. */
export const radarrEvents = (payload: RadarrWebhook): ReadonlyArray<FlowEvent> => {
  const movie = payload.movie
  if (movie === undefined) return []
  const subject = { kind: "media" as const, key: movieKey(movie.tmdbId), title: titleOf(movie), mediaType: "movie" as const }
  switch (payload.eventType) {
    case "MovieAdded":
      return [{ type: "media.added", subject }]
    case "Grab":
      return payload.downloadId === undefined
        ? []
        : [{ type: "media.grabbed", subject, downloadId: payload.downloadId.toLowerCase() }]
    case "Download":
      return [{ type: "media.imported", subject }]
    default:
      return []
  }
}

export const decodeRadarrWebhook = Schema.decodeUnknownEffect(RadarrWebhook)

/** What Quai needs to check in Jellyfin once Radarr has imported the file. */
export const radarrAvailability = (payload: RadarrWebhook) =>
  payload.eventType === "Download" && payload.movie !== undefined
    ? {
      _tag: "Movie" as const,
      mediaKey: movieKey(payload.movie.tmdbId),
      tmdbId: payload.movie.tmdbId,
      title: payload.movie.title
    }
    : null
