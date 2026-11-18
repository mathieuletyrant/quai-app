import { Schema } from "effect"
import type { MediaEvent } from "../engine/Events.ts"
import { movieKey } from "../engine/Events.ts"

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

/** Radarr's events in the engine's terms. Events Quai doesn't follow give nothing. */
export const radarrEvents = (payload: RadarrWebhook): ReadonlyArray<MediaEvent> => {
  const movie = payload.movie
  if (movie === undefined) return []
  const mediaKey = movieKey(movie.tmdbId)
  const title = titleOf(movie)
  switch (payload.eventType) {
    case "MovieAdded":
      return [{ _tag: "Added", mediaKey, title }]
    case "Grab":
      return payload.downloadId === undefined
        ? []
        : [{ _tag: "Grabbed", mediaKey, title, downloadId: payload.downloadId.toLowerCase() }]
    case "Download":
      return [{ _tag: "Imported", mediaKey, title }]
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
