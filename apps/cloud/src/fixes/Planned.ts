import type { HomeOffline } from "@quai/api"
import { Effect, Option } from "effect"
import type { HomeReads } from "../home/HomeReads.ts"
import { epochSeconds, type QueueRecord } from "../integrations/arr.ts"
import {
  plannedRemovals,
  queueCleanerJobRead,
  queuedByDownload,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead,
  struckDownloads
} from "../integrations/cleanuparr.ts"
import { type RadarrMovie, RadarrMovies } from "../integrations/radarr.ts"
import { type Candidate, deletionCandidates, isMovie, scheduledDeletions } from "../integrations/reclaimerr.ts"
import { type SonarrSeries as SonarrSeriesOne, SonarrSeries } from "../integrations/sonarr.ts"
import type { Detected } from "./Detected.ts"
import { movies } from "./movies.ts"
import { series } from "./series.ts"

/**
 * What the services plan on their own, read once for the To fix list and Upcoming: the deletions
 * Reclaimerr plans and the downloads Cleanuparr's queue cleaner removes at its next strike.
 */

/** The Radarr movies and Sonarr series Reclaimerr's planned deletions are, read only when one is planned. */
export interface CandidateLibrary {
  readonly movies?: ReadonlyArray<RadarrMovie> | undefined
  readonly series?: ReadonlyArray<SonarrSeriesOne> | undefined
}

/** The libraries the planned deletions need; one that can't be read is left out. */
export const candidateLibrary = (reads: HomeReads["Service"], candidates: ReadonlyArray<Candidate>) =>
  Effect.gen(function*(): Effect.fn.Return<CandidateLibrary, HomeOffline> {
    const due = deletionCandidates(candidates)
    const { values } = yield* reads.all({
      movies: due.some(isMovie) ? { service: "radarr", path: "/api/v3/movie", schema: RadarrMovies } : null,
      series: due.some((c) => !isMovie(c)) ? { service: "sonarr", path: "/api/v3/series", schema: SonarrSeries } : null
    }, { optional: ["movies", "series"] })
    return { movies: Option.getOrUndefined(values.movies), series: Option.getOrUndefined(values.series) }
  })

/**
 * Reclaimerr gives no poster: its scheduled deletions take theirs from the Radarr movie or Sonarr
 * series they are. A library that can't be read leaves the deletion without a poster; Quai Home gone
 * offline fails, like every other read.
 */
export const deletionsWithPosters = (reads: HomeReads["Service"], candidates: ReadonlyArray<Candidate>) =>
  Effect.map(candidateLibrary(reads, candidates), (library) => scheduledDeletions(candidates, library))

/**
 * Cleanuparr's planned removals: its strikes, limits and next run, then, when a download is struck,
 * the queues of the *arr that hold it (its title and poster; one no queue has is gone). None when
 * Cleanuparr didn't answer; a queue that can't be read leaves its downloads out.
 */
export const plannedRemovalsRead = (reads: HomeReads["Service"]) =>
  Effect.gen(function*(): Effect.fn.Return<Option.Option<ReadonlyArray<Detected>>, HomeOffline> {
    const { values } = yield* reads.all({
      strikes: strikesRead,
      settings: settingsRead,
      stallRules: stallRulesRead,
      slowRules: slowRulesRead,
      job: queueCleanerJobRead
    }, { optional: ["job"] })
    const needed = Option.all([values.strikes, values.settings, values.stallRules, values.slowRules])
    if (Option.isNone(needed)) return Option.none()
    const [strikes, settings, stallRules, slowRules] = needed.value
    if (struckDownloads({ downloads: strikes.items, settings }).length === 0) return Option.some([])
    const reached = yield* reads.services
    const queues = yield* Effect.forEach([movies, series] as const, (adapter) => {
      const queued = adapter.queued
      return reached.includes(adapter.service)
        ? Effect.map(reads.read(adapter.queue), (page) => ({ queued, records: Option.match(page, { onNone: () => [], onSome: (p) => p.records }) }))
        : Effect.succeed({ queued, records: [] as ReadonlyArray<QueueRecord> })
    }, { concurrency: "unbounded" })
    const job = Option.getOrUndefined(values.job)
    return Option.some(plannedRemovals({
      downloads: strikes.items,
      settings,
      stallRules,
      slowRules,
      nextRunAt: epochSeconds(job?.nextRunTime ?? undefined),
      queued: queuedByDownload(queues)
    }))
  })
