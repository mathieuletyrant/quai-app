import type { HomeOffline } from "@quai/api"
import { Effect, Option } from "effect"
import type { HomeReads } from "../home/HomeReads.ts"
import { epochSeconds, type QueueRecord } from "../integrations/arr.ts"
import {
  stuckRemovals,
  queueCleanerJobRead,
  queuedByDownload,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead,
  struckDownloads
} from "../integrations/cleanuparr.ts"
import { radarrMoviesRead } from "../integrations/radarr.ts"
import { isMovie, type PlannedCandidate, plannedDeletionFixes } from "../integrations/reclaimerr.ts"
import { sonarrSeriesRead } from "../integrations/sonarr.ts"
import type { Detected } from "./Detected.ts"
import { movies } from "./movies.ts"
import { series } from "./series.ts"

/**
 * What the services plan on their own, read once for the To fix list and Upcoming: the deletions
 * Reclaimerr plans and the downloads Cleanuparr's queue cleaner removes at its next strike.
 */

/**
 * Reclaimerr gives no poster: its planned deletions take theirs from the Radarr movie or Sonarr
 * series they are, read only when one is planned. A library that can't be read leaves the deletion
 * without a poster; Quai Home gone offline fails, like every other read.
 */
export const deletionsWithPosters = (reads: HomeReads["Service"], planned: ReadonlyArray<PlannedCandidate>) =>
  Effect.gen(function*(): Effect.fn.Return<ReadonlyArray<Detected>, HomeOffline> {
    if (planned.length === 0) return []
    const { values } = yield* reads.all({
      movies: planned.some((p) => isMovie(p.candidate)) ? radarrMoviesRead : null,
      series: planned.some((p) => !isMovie(p.candidate)) ? sonarrSeriesRead : null
    }, { optional: ["movies", "series"] })
    return plannedDeletionFixes(planned, { movies: Option.getOrUndefined(values.movies), series: Option.getOrUndefined(values.series) })
  })

/**
 * Cleanuparr's stuck removals: its strikes, limits and next run, then, when a download is struck,
 * the queues of the *arr that hold it (its title and poster; one no queue has is gone). None when
 * Cleanuparr didn't answer; a queue that can't be read leaves its downloads out.
 */
export const stuckRemovalsRead = (reads: HomeReads["Service"]) =>
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
    return Option.some(stuckRemovals({
      downloads: strikes.items,
      settings,
      stallRules,
      slowRules,
      nextRunAt: epochSeconds(job?.nextRunTime ?? undefined),
      queued: queuedByDownload(queues)
    }))
  })
