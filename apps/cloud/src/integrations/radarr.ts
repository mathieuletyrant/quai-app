import type { DiskSpace, LibraryItem } from "@quai/api"
import { Effect, Schema } from "effect"
import { type Detected, noSourceAfterMs } from "../fixes/Detected.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { movieKey } from "../flows/Events.ts"
import { ArrImage, epochSeconds, knownYear, posterOf, type QueueRecord, queueMessages, queuePageSize } from "./arr.ts"
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

const LibraryMovie = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  year: Schema.optional(Schema.Number),
  tmdbId: Schema.Number,
  added: Schema.optional(Schema.String),
  hasFile: Schema.optional(Schema.Boolean),
  monitored: Schema.optional(Schema.Boolean),
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

/**
 * A movie as the library lists it: on disk when it has its file; else wanted while Radarr is
 * monitoring it (before it's out too: Radarr grabs it once it is), not monitored otherwise.
 */
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
    status: movie.hasFile === true ? "available" : movie.monitored === false ? "notMonitored" : "wanted",
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

// The To fix list: the queue (blocked imports), the movies still without a file, and the grabs
// that happened for them, read when the list is asked for.

export const radarrQueuePath = `/api/v3/queue?page=1&pageSize=${queuePageSize}&includeUnknownMovieItems=true&includeMovie=true`

/** Monitored movies without a file. One page: a home rarely misses a thousand. */
export const radarrMissingPath = "/api/v3/wanted/missing?page=1&pageSize=1000&monitored=true"

/** The grabs since `ms` (epoch milliseconds). */
export const grabsSincePath = (ms: number) => `/api/v3/history/since?date=${encodeURIComponent(new Date(ms).toISOString())}&eventType=grabbed`

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
  eventType: Schema.optional(Schema.String)
}))

/** When the movie became something Radarr searches for: its minimum availability, never before it was added. */
export const availableSince = (movie: MissingMovie): number | undefined => {
  const added = epochSeconds(movie.added)
  const dates = movie.minimumAvailability === "announced"
    ? []
    : movie.minimumAvailability === "inCinemas"
    ? [movie.inCinemas]
    : [movie.digitalRelease, movie.physicalRelease]
  const released = dates.map(epochSeconds).filter((d): d is number => d !== undefined)
  const availableAt = released.length === 0 ? undefined : Math.min(...released)
  if (added === undefined) return availableAt
  return availableAt === undefined ? added : Math.max(added, availableAt)
}

/** A finished download Radarr won't import. Import anyway needs the movie, and no file for it yet. */
export const blockedMovie = (record: QueueRecord): Detected => {
  const messages = queueMessages(record)
  const movie = record.movie
  const year = knownYear(movie?.year)
  const posterUrl = posterOf(movie?.images)
  const since = epochSeconds(record.added)
  const movieId = record.movieId ?? undefined
  const importable = movieId !== undefined && movie !== undefined && movie.hasFile !== true
  return {
    fix: {
      id: `blocked-radarr-${record.id}`,
      kind: "importBlocked",
      service: "radarr",
      title: movie?.title ?? record.title ?? "Unknown download",
      ...(year === undefined ? {} : { year }),
      ...(posterUrl === undefined ? {} : { posterUrl }),
      reason: messages[0] ?? "Waiting for a manual import",
      ...(since === undefined ? {} : { since }),
      actions: importable ? ["importAnyway", "remove"] : ["remove"],
      download: {
        release: record.title ?? "",
        messages,
        ...(record.downloadClient ? { downloadClient: record.downloadClient } : {})
      }
    },
    target: {
      _tag: "Queue",
      service: "radarr",
      queueId: record.id,
      downloadId: record.downloadId ?? undefined,
      movieId,
      seriesId: undefined,
      seasonNumber: undefined
    }
  }
}

/**
 * Monitored movies Radarr considers available, still without a file, with nothing in the queue and
 * no grab since they became available, for over 2 hours.
 */
export const moviesWithoutSource = (
  missing: ReadonlyArray<MissingMovie>,
  queue: ReadonlyArray<QueueRecord>,
  grabs: typeof RadarrGrabs.Type,
  nowMs: number
): ReadonlyArray<Detected> => {
  const queued = new Set(queue.flatMap((r) => r.movieId === undefined || r.movieId === null ? [] : [r.movieId]))
  return missing.flatMap((movie): ReadonlyArray<Detected> => {
    if (movie.hasFile === true || movie.monitored === false || movie.isAvailable !== true || queued.has(movie.id)) return []
    const since = availableSince(movie)
    if (since === undefined || nowMs - since * 1000 < noSourceAfterMs) return []
    const grabbed = grabs.some((g) => g.movieId === movie.id && (g.eventType ?? "grabbed") === "grabbed" && (epochSeconds(g.date) ?? 0) >= since)
    if (grabbed) return []
    const year = knownYear(movie.year)
    const posterUrl = posterOf(movie.images)
    const added = epochSeconds(movie.added)
    return [{
      fix: {
        id: `missing-movie-${movie.id}`,
        kind: "noSource",
        service: "radarr",
        title: movie.title,
        ...(year === undefined ? {} : { year }),
        ...(posterUrl === undefined ? {} : { posterUrl }),
        reason: added !== undefined && since > added ? "No release grabbed since it came out" : "No release grabbed since it was added",
        since,
        actions: ["searchReleases", "snooze"],
        missing: { episodes: [] }
      },
      target: { _tag: "MissingMovie", movieId: movie.id }
    }]
  })
}

// Tonight's releases: the movies out today, `GET /api/v3/calendar`.

/**
 * Monitored movies with a date between two instants. Radarr's release dates are days (midnight
 * UTC): the caller asks a little wider and keeps those whose day is the home's.
 */
export const radarrCalendarPath = (startMs: number, endMs: number) =>
  `/api/v3/calendar?start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${encodeURIComponent(new Date(endMs).toISOString())}&unmonitored=false`

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
