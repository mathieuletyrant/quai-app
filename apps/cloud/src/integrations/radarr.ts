import type { LibraryItem } from "@quai/api"
import { Clock, Effect, Option, Schema } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { knownId, movieKey } from "../flows/Events.ts"
import { HomeReads, type Read } from "../home/HomeReads.ts"
import * as LibraryId from "../library/LibraryId.ts"
import { type Arrival, DiskReadings } from "../storage/DiskReadings.ts"
import {
  ArrImage,
  epochSeconds,
  grabsSincePath,
  importBlockedDetail,
  knownYear,
  posterOf,
  queuePageSize
} from "./arr.ts"
import type { Integration } from "./Integration.ts"

const Movie = Schema.Struct({
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tmdbId: Schema.Number,
  imdbId: Schema.optional(Schema.NullOr(Schema.String))
})

/** The Radarr webhook payload, only the fields Quai reads. Unknown event types are kept as-is. */
export const RadarrWebhook = Schema.Struct({
  eventType: Schema.String,
  movie: Schema.optional(Movie),
  movieFile: Schema.optional(Schema.Struct({ size: Schema.optional(Schema.Number) })),
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
    lookup: {
      _tag: "Movie" as const,
      tmdbId: movie.tmdbId,
      ...(knownId(movie.imdbId) === undefined ? {} : { imdbId: movie.imdbId! }),
      title: movie.title
    }
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
    case "ManualInteractionRequired":
      return [{ type: "media.importBlocked", subject, values: { detail: importBlockedDetail } }]
    default:
      return []
  }
}

export const decodeRadarrWebhook = Schema.decodeUnknownEffect(RadarrWebhook)

/** A movie's file imported, as its disk mark; none for any other event. */
export const radarrArrival = (payload: RadarrWebhook, at: number): Arrival | undefined =>
  payload.eventType !== "Download" || payload.movie === undefined ? undefined : {
    service: "radarr",
    titleKey: movieKey(payload.movie.tmdbId),
    title: titleOf(payload.movie),
    at,
    bytes: payload.movieFile?.size ?? 0
  }

/** A movie by its TMDB id, for Radarr's own verdict on it: "Missing" or "Not Available". */
export const movieAvailabilityRead = (
  tmdbId: number
): Read<ReadonlyArray<{ readonly isAvailable?: boolean | undefined }>> => ({
  service: "radarr",
  path: `/api/v3/movie?tmdbId=${tmdbId}`,
  schema: Schema.Array(Schema.Struct({ isAvailable: Schema.optional(Schema.Boolean) }))
})

/**
 * Radarr pushes: added, grabbed and imported come by webhook (an import is a disk mark too). It has no actions yet. A movie added
 * before it is out (Radarr lists it "Not Available") starts nothing: Radarr won't search it until
 * then, and its grab starts the activity on the day. When Radarr can't say, the activity starts.
 */
export const radarr = Effect.gen(function*() {
  const reads = yield* HomeReads
  const readings = yield* DiskReadings

  const notAvailableYet = (tmdbId: number) =>
    reads.read(movieAvailabilityRead(tmdbId)).pipe(
      Effect.map(Option.match({ onNone: () => false, onSome: (movies) => movies[0]?.isAvailable === false })),
      Effect.catchTag("HomeOffline", () => Effect.succeed(false))
    )

  const integration: Integration = {
    service: "radarr",
    webhook: {
      read: (body) =>
        Effect.gen(function*() {
          const payload = yield* decodeRadarrWebhook(body)
          const arrival = radarrArrival(payload, yield* Clock.currentTimeMillis)
          if (arrival !== undefined) yield* readings.arrived(arrival)
          const events = radarrEvents(payload)
          if (payload.eventType !== "MovieAdded" || payload.movie === undefined) return events
          return (yield* notAvailableYet(payload.movie.tmdbId)) ? [] : events
        })
    },
    actions: {}
  }
  return integration
})

// The library: `GET /api/v3/movie`, read once when the app asks.

const LibraryMovie = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tmdbId: Schema.Number,
  /** The movie's page in Radarr's web UI is `/movie/<titleSlug>`. */
  titleSlug: Schema.optional(Schema.String),
  added: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
  /** Radarr's own verdict: past its minimum availability. False is its "Not Available". */
  isAvailable: Schema.optional(Schema.Boolean),
  sizeOnDisk: Schema.optional(Schema.Number),
  overview: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage))
})
export const RadarrMovies = Schema.Array(LibraryMovie)
export type RadarrMovie = typeof LibraryMovie.Type

/** Every movie: the library, the posters of Reclaimerr's deletions, Upcoming's space back. */
export const radarrMoviesRead: Read<typeof RadarrMovies.Type> & { readonly service: "radarr" } = {
  service: "radarr",
  path: "/api/v3/movie",
  schema: RadarrMovies
}

/**
 * A movie as the library lists it: on disk when it has its file; else wanted while Radarr is
 * monitoring it (before it's out too: Radarr grabs it once it is), not monitored otherwise.
 */
/** The movie's page at each of Radarr's web addresses. */
export const movieWebUrls = (movie: RadarrMovie, bases: ReadonlyArray<string>) =>
  movie.titleSlug === undefined ? [] : bases.map((base) => `${base}/movie/${encodeURIComponent(movie.titleSlug!)}`)

/** As Radarr sorts it: on disk, not monitored, Not Available, or Missing (wanted). */
const movieStatus = (movie: RadarrMovie): LibraryItem["status"] => {
  if (movie.hasFile === true) return "available"
  if (movie.monitored === false) return "notMonitored"
  if (movie.isAvailable === false) return "notAvailable"
  return "wanted"
}

export const libraryMovie = (movie: RadarrMovie, webBases: ReadonlyArray<string> = []): LibraryItem => {
  const webUrls = movieWebUrls(movie, webBases)
  const year = knownYear(movie.year)
  const posterUrl = posterOf(movie.images)
  const addedAt = epochSeconds(movie.added)
  return {
    id: LibraryId.movie(movie.id),
    kind: "movie",
    title: movie.title,
    ...(year === undefined ? {} : { year }),
    tmdbId: movie.tmdbId,
    ...(posterUrl === undefined ? {} : { posterUrl }),
    status: movieStatus(movie),
    ...(addedAt === undefined ? {} : { addedAt }),
    sizeBytes: movie.sizeOnDisk ?? 0,
    ...(movie.overview === undefined || movie.overview === "" ? {} : { overview: movie.overview }),
    ...(webUrls.length === 0 ? {} : { webUrls })
  }
}

// The To fix list's reads (fixes/movies.ts): the queue (blocked imports), the movies still without
// a file, and the grabs that happened for them.

export const radarrQueuePath =
  `/api/v3/queue?page=1&pageSize=${queuePageSize}&includeUnknownMovieItems=true&includeMovie=true`

/** Monitored movies without a file. One page: a home rarely misses a thousand. */
export const radarrMissingPath = "/api/v3/wanted/missing?page=1&pageSize=1000&monitored=true"

const MissingMovie = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  added: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
  /** Radarr's own verdict: past its minimum availability (and the availability delay). */
  isAvailable: Schema.optional(Schema.Boolean),
  minimumAvailability: Schema.optional(Schema.String),
  inCinemas: Schema.optional(Schema.String),
  digitalRelease: Schema.optional(Schema.String),
  physicalRelease: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage))
})
export type MissingMovie = typeof MissingMovie.Type
export const RadarrMissing = Schema.Struct({ records: Schema.Array(MissingMovie) })

export const RadarrGrabs = Schema.Array(Schema.Struct({
  movieId: Schema.Number,
  date: Schema.String,
  eventType: Schema.optional(Schema.String),
  /** The release's name. */
  sourceTitle: Schema.optional(Schema.String),
  /** The download's id: a torrent's hash. */
  downloadId: Schema.optional(Schema.NullOr(Schema.String))
}))

/** The grabs since `ms`: what To fix knows was grabbed, what Upcoming ties each torrent to. */
export const radarrGrabsRead = (ms: number): Read<typeof RadarrGrabs.Type> & { readonly service: "radarr" } => ({
  service: "radarr",
  path: grabsSincePath(ms),
  schema: RadarrGrabs
})

// Today's releases: the movies out today, `GET /api/v3/calendar`.

/**
 * Monitored movies with a date between two instants. Radarr's release dates are days (midnight
 * UTC): the caller asks a little wider and keeps those whose day is the home's.
 */
export const radarrCalendarPath = (startMs: number, endMs: number) =>
  `/api/v3/calendar?start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${
    encodeURIComponent(new Date(endMs).toISOString())
  }&unmonitored=false`

export const RadarrCalendar = Schema.Array(Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
  inCinemas: Schema.optional(Schema.String),
  digitalRelease: Schema.optional(Schema.String),
  physicalRelease: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ArrImage))
}))
export type RadarrCalendarMovie = (typeof RadarrCalendar.Type)[number]

export const radarrCalendarQueuePath = `/api/v3/queue?page=1&pageSize=${queuePageSize}`

/** A movie's home release (digital or physical) falls on this day ("2026-11-20"). Cinemas don't count. */
export const releasedOn = (movie: RadarrCalendarMovie, day: string) =>
  [movie.digitalRelease, movie.physicalRelease].some((date) => date?.slice(0, 10) === day)
