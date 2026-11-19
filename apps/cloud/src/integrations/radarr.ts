import type { DiskSpace, LibraryItem } from "@quai/api"
import { Effect, Schema } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { movieKey } from "../flows/Events.ts"
import type { Integration } from "./Integration.ts"

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
  const subject = {
    kind: "media" as const,
    key: movieKey(movie.tmdbId),
    title: titleOf(movie),
    mediaType: "movie" as const,
    lookup: { _tag: "Movie" as const, tmdbId: movie.tmdbId, title: movie.title }
  }
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

/** Radarr pushes: added, grabbed and imported come by webhook. It has no actions yet. */
export const radarr: Integration = {
  service: "radarr",
  webhook: { read: (body) => Effect.map(decodeRadarrWebhook(body), radarrEvents) },
  actions: {}
}

// The library: `GET /api/v3/movie` and `GET /api/v3/diskspace`, read once when the app asks.

export const ArrImage = Schema.Struct({
  coverType: Schema.String,
  remoteUrl: Schema.optional(Schema.String)
})

const LibraryMovie = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tmdbId: Schema.Number,
  added: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  sizeOnDisk: Schema.optional(Schema.Number),
  overview: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage))
})
export const RadarrMovies = Schema.Array(LibraryMovie)
export type RadarrMovie = typeof LibraryMovie.Type

export const DiskSpaces = Schema.Array(Schema.Struct({
  path: Schema.optional(Schema.String),
  freeSpace: Schema.Number,
  totalSpace: Schema.Number
}))

/** The poster's public URL (TMDB, TheTVDB). Never the service's own `url`: that one needs its key. */
export const posterOf = (images: ReadonlyArray<typeof ArrImage.Type> | undefined): string | undefined => {
  const remote = images?.find((i) => i.coverType === "poster")?.remoteUrl
  return remote !== undefined && /^https:\/\//.test(remote) ? remote : undefined
}

/** Epoch seconds of an *arr date; their "unknown" is year 1 (`0001-01-01T00:00:00Z`). */
export const epochSeconds = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) || ms <= 0 ? undefined : Math.floor(ms / 1000)
}

/** A year the *arr knows: they write 0 when they don't. */
export const knownYear = (year: number | undefined) => year !== undefined && year > 0 ? Math.trunc(year) : undefined

/** A movie as the library lists it: on disk when it has its file, wanted otherwise. */
export const libraryMovie = (movie: RadarrMovie): LibraryItem => {
  const year = knownYear(movie.year)
  const posterUrl = posterOf(movie.images)
  const addedAt = epochSeconds(movie.added)
  return {
    id: `movie:${movie.id}`,
    kind: "movie",
    title: movie.title,
    ...(year === undefined ? {} : { year }),
    ...(posterUrl === undefined ? {} : { posterUrl }),
    status: movie.hasFile === true ? "available" : "wanted",
    ...(addedAt === undefined ? {} : { addedAt }),
    sizeBytes: movie.sizeOnDisk ?? 0,
    ...(movie.overview === undefined || movie.overview === "" ? {} : { overview: movie.overview })
  }
}

/**
 * The disk the media is on. Radarr lists every mount it sees (`/`, `/config`, `/downloads`…,
 * often the same disk several times): the largest one holds the library.
 */
export const mediaDisk = (disks: typeof DiskSpaces.Type): DiskSpace | undefined => {
  const largest = [...disks].sort((a, b) => b.totalSpace - a.totalSpace)[0]
  return largest === undefined || largest.totalSpace <= 0
    ? undefined
    : { freeBytes: largest.freeSpace, totalBytes: largest.totalSpace }
}
