import { InvalidFix } from "@quai/api"
import { Effect, Option, Result } from "effect"
import {
  echoed,
  epochSeconds,
  fileOf,
  grabLookbackMs,
  grabsSincePath,
  isImportBlocked,
  knownYear,
  posterOf,
  type QueueRecord,
  QueuePage,
  queueMessages
} from "../integrations/arr.ts"
import {
  type MissingMovie,
  RadarrGrabs,
  RadarrMissing,
  radarrMissingPath,
  radarrQueuePath
} from "../integrations/radarr.ts"
import { type Detected, noSourceAfterMs } from "./Detected.ts"
import * as FixId from "./FixId.ts"
import { type ImportCommandFile, type ImportInput, importFileOf, type MediaFixes } from "./MediaFixes.ts"

/** What a movie's problem acts on: its blocked download, or the movie without a source. */
export type MovieTarget =
  | {
    readonly kind: "movie"
    readonly _tag: "Queue"
    readonly queueId: number
    readonly downloadId: string | undefined
    readonly movieId: number | undefined
  }
  | { readonly kind: "movie"; readonly _tag: "Missing"; readonly movieId: number }

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
export const blockedMovie = (record: QueueRecord): Detected<MovieTarget> => {
  const messages = queueMessages(record)
  const movie = record.movie
  const year = knownYear(movie?.year)
  const posterUrl = posterOf(movie?.images)
  const since = epochSeconds(record.added)
  const movieId = record.movieId ?? undefined
  const importable = movieId !== undefined && movie !== undefined && movie.hasFile !== true
  return {
    fix: {
      id: FixId.blocked("radarr", record.id),
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
    target: { kind: "movie", _tag: "Queue", queueId: record.id, downloadId: record.downloadId ?? undefined, movieId }
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
): ReadonlyArray<Detected<MovieTarget>> => {
  const queued = new Set(queue.flatMap((r) => r.movieId === undefined || r.movieId === null ? [] : [r.movieId]))
  return missing.flatMap((movie): ReadonlyArray<Detected<MovieTarget>> => {
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
        id: FixId.missingMovie(movie.id),
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
      target: { kind: "movie", _tag: "Missing", movieId: movie.id }
    }]
  })
}

/** Each file is the movie Radarr matched it to, or the download's; never over a file already there. */
export const movieImportFiles = (
  { downloadId, rows, target }: ImportInput<MovieTarget>
): Result.Result<ReadonlyArray<ImportCommandFile>, InvalidFix> => {
  const files: Array<ImportCommandFile> = []
  for (const row of rows) {
    const movieId = row.movie?.id ?? target.movieId
    if (movieId === undefined) return Result.fail(new InvalidFix({ message: `Radarr doesn't know which movie ${fileOf(row)} is` }))
    // Importing over a file would replace it: the owner's rule is no upgrades.
    if (row.movie?.hasFile === true) return Result.fail(new InvalidFix({ message: "This movie already has a file" }))
    files.push({ path: row.path!, movieId, downloadId, ...echoed(row) })
  }
  return Result.succeed(files)
}

/** The To fix list's movies: Radarr's. */
export const movies: MediaFixes<MovieTarget> = {
  kind: "movie",
  service: "radarr",
  detect: (reads, nowMs) =>
    Effect.map(
      reads.all({
        queue: { service: "radarr", path: radarrQueuePath, schema: QueuePage },
        missing: { service: "radarr", path: radarrMissingPath, schema: RadarrMissing },
        grabs: { service: "radarr", path: grabsSincePath(nowMs - grabLookbackMs), schema: RadarrGrabs }
      }),
      ({ values }) =>
        // The rules need all three reads.
        Option.map(Option.all([values.queue, values.missing, values.grabs]), ([queue, missing, grabs]) => [
          ...queue.records.filter(isImportBlocked).map(blockedMovie),
          ...moviesWithoutSource(missing.records, queue.records, grabs, nowMs)
        ])
    ),
  importHints: () => "",
  importFile: (row) => importFileOf(row, [], false),
  choices: () => Effect.succeed([]),
  importFiles: movieImportFiles,
  releaseSearch: (target) => `/api/v3/release?movieId=${target.movieId}`,
  usable: () => true
}
