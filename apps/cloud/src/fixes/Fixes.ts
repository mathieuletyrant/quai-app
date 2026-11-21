import {
  type Fix,
  FixFailed,
  type Fixes as FixList,
  type FixService,
  HomeOffline,
  type ImportPreview,
  InvalidFix,
  type Releases
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpApiError } from "effect/http-api"
import { type CallRequest, HomeDocuments, toOffline } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { byPreference, epochSeconds, ManualImportRows, type QueueRecord, ReleaseRecords, toRelease } from "../integrations/arr.ts"
import {
  excluding,
  plannedRemovals,
  queueCleanerJobRead,
  queuedByDownload,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead,
  struckDownloads
} from "../integrations/cleanuparr.ts"
import { readJson } from "../integrations/Integration.ts"
import { RadarrMovies } from "../integrations/radarr.ts"
import {
  type Candidate,
  CandidatePage,
  candidatesPath,
  deletionCandidates,
  isMovie,
  protectPath,
  protectReason,
  scheduledDeletions
} from "../integrations/reclaimerr.ts"
import { SonarrSeries } from "../integrations/sonarr.ts"
import { Journal } from "../journal/Journal.ts"
import type { Detected, FixTarget, RemovalTarget } from "./Detected.ts"
import * as FixId from "./FixId.ts"
import {
  type ImportAssignments,
  importFiles,
  isMissing,
  isQueued,
  type MediaFixes,
  type MediaTarget,
  type MissingOf,
  type QueuedOf
} from "./MediaFixes.ts"
import { movies } from "./movies.ts"
import { series } from "./series.ts"

/** Where what the user hid is kept, at home: `fixes/snoozed/<fix id>`, `fixes/dismissed/<fix id>`. */
export const hiddenPrefix = "fixes/"
const snoozedKey = (id: string) => `fixes/snoozed/${id}`
export const dismissedKey = (id: string) => `fixes/dismissed/${id}`

/** A snooze: until a date, or (no `until`) until the problem goes away, a release grabbed. */
const Hidden = Schema.Struct({ at: Schema.Number, until: Schema.optional(Schema.Number) })
const decodeHidden = Schema.decodeUnknownOption(Hidden)

/** The Cloud waits a little longer than Quai Home waits for the indexers. */
const releaseSearchTimeoutMs = 55_000

type FixError = HomeOffline | HttpApiError.NotFound | InvalidFix | FixFailed

const order: Record<Fix["kind"], number> = { scheduledDeletion: 0, removalPlanned: 1, noSource: 2, importBlocked: 3 }
const goesAt = (fix: Fix) => fix.deletion?.deletesAt ?? fix.removal?.removesAt ?? 0
const byUrgency = (a: Detected, b: Detected) =>
  order[a.fix.kind] - order[b.fix.kind] ||
  goesAt(a.fix) - goesAt(b.fix) ||
  (a.fix.since ?? 0) - (b.fix.since ?? 0)

/** The media adapters, in the order their problems are listed and their services reported. */
const media = [movies, series] as const

/** Runs `f` with the adapter of a movie's or a series' target; undefined for a Reclaimerr candidate or a Cleanuparr download. */
const withMedia = <R>(target: FixTarget, f: <T extends MediaTarget>(adapter: MediaFixes<T>, target: T) => R): R | undefined =>
  target.kind === "movie" ? f(movies, target) : target.kind === "series" ? f(series, target) : undefined

interface Detection {
  readonly detected: ReadonlyArray<Detected>
  /** The services read in full this time. */
  readonly read: ReadonlyArray<FixService>
  readonly unavailable: ReadonlyArray<FixService>
}

/**
 * The To fix list (packages/api `Fixes.ts`): fixed rules run on what Quai Home reads, when asked.
 * The rules of movies and series are their adapters' (`movies.ts`, `series.ts`); this runs what
 * they share. Nothing about the problems is kept; what the user hid lives in home documents, and
 * those whose problem is gone are cleared as the list is read.
 */
export class Fixes extends Context.Service<Fixes, {
  readonly list: Effect.Effect<FixList, HomeOffline>
  readonly remove: (id: string, blocklist: boolean) => Effect.Effect<void, FixError>
  readonly importPreview: (id: string) => Effect.Effect<ImportPreview, FixError>
  readonly importDownload: (id: string, assignments: ImportAssignments) => Effect.Effect<void, FixError>
  readonly keep: (id: string) => Effect.Effect<void, FixError>
  readonly dismiss: (id: string) => Effect.Effect<void, FixError>
  readonly snooze: (id: string, days: number | undefined) => Effect.Effect<void, FixError>
  readonly releases: (id: string) => Effect.Effect<Releases, FixError>
  readonly grab: (id: string, release: { readonly guid: string; readonly indexerId: number }) => Effect.Effect<void, FixError>
}>()("quai/Fixes") {
  static readonly layer = Layer.effect(
    Fixes,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const documents = yield* HomeDocuments
      const journal = yield* Journal

      /** A write (or a read that must succeed) through Quai Home: its failure, or the service's refusal, in words. */
      const write = (call: CallRequest, options?: { readonly timeoutMs?: number }) =>
        reads.write(call, (message) => new FixFailed({ message }), options)

      /**
       * Reclaimerr gives no poster: its scheduled deletions take theirs from the Radarr movie or
       * Sonarr series they are, read only when one is listed (the To fix reads don't hold titles
       * with a file). A library that can't be read leaves the deletion without a poster; Quai Home
       * gone offline fails the list, like every other read.
       */
      const deletionsWithPosters = (candidates: ReadonlyArray<Candidate>) =>
        Effect.gen(function*() {
          const due = deletionCandidates(candidates)
          const { values } = yield* reads.all({
            movies: due.some(isMovie) ? { service: "radarr", path: "/api/v3/movie", schema: RadarrMovies } : null,
            series: due.some((c) => !isMovie(c)) ? { service: "sonarr", path: "/api/v3/series", schema: SonarrSeries } : null
          }, { optional: ["movies", "series"] })
          return scheduledDeletions(candidates, { movies: Option.getOrUndefined(values.movies), series: Option.getOrUndefined(values.series) })
        })

      /**
       * Cleanuparr's planned removals: its strikes, limits and next run, then, when a download is
       * struck, the queues of the *arr that hold it (its title and poster; one no queue has is gone).
       * None when Cleanuparr didn't answer; a queue that can't be read leaves its downloads out.
       */
      const removals = Effect.gen(function*(): Effect.fn.Return<Option.Option<ReadonlyArray<Detected>>, HomeOffline> {
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
        const queues = yield* Effect.forEach(media, (adapter) => {
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

      /** Keep: Cleanuparr's queue cleaner leaves the download alone, its other settings as they are. */
      const exclude = (target: RemovalTarget) =>
        Effect.gen(function*() {
          // As Cleanuparr answered, not as decoded: Quai Home compares the two exactly.
          const answered = yield* write({ service: "cleanuparr", method: "GET", path: settingsRead.path })
          const body = excluding(answered, target.downloadId)
          if (Option.isNone(body)) return yield* Effect.fail(new FixFailed({ message: "Cleanuparr answered something Quai can't read" }))
          yield* write({ service: "cleanuparr", method: "PUT", path: settingsRead.path, body: body.value })
        })

      /** Runs the rules on the services asked (those Quai Home reaches). */
      const detect = (only?: FixService) =>
        Effect.gen(function*(): Effect.fn.Return<Detection, HomeOffline> {
          const nowMs = yield* Clock.currentTimeMillis
          const reached = yield* reads.services
          const asked = (service: FixService) => (only === undefined || only === service) && reached.includes(service)
          const none = Effect.succeed(Option.none<never>())
          const [candidates, planned, ...found] = yield* Effect.all([
            asked("reclaimerr") ? reads.read({ service: "reclaimerr", path: candidatesPath, schema: CandidatePage }) : none,
            asked("cleanuparr") ? removals : none,
            ...media.map((adapter) => asked(adapter.service) ? adapter.detect(reads, nowMs) : none)
          ], { concurrency: "unbounded" })
          const outcomes: ReadonlyArray<readonly [FixService, Option.Option<unknown>]> = [
            ["reclaimerr", candidates],
            ["cleanuparr", planned],
            ...media.map((adapter, i) => [adapter.service, found[i]!] as const)
          ]
          const unavailable = outcomes.flatMap(([service, value]) => asked(service) && Option.isNone(value) ? [service] : [])
          const deletions = Option.isNone(candidates)
            ? []
            : only === undefined
            ? yield* deletionsWithPosters(candidates.value.items)
            // Acting on a deletion needs no poster.
            : scheduledDeletions(candidates.value.items)
          const detected = found.flatMap((problems: Option.Option<ReadonlyArray<Detected>>) => Option.getOrElse(problems, () => []))
          return {
            detected: [...deletions, ...Option.getOrElse(planned, () => []), ...detected].sort(byUrgency),
            read: outcomes.flatMap(([service]) => asked(service) && !unavailable.includes(service) ? [service] : []),
            unavailable
          }
        })

      /** The problem by id, found again now: acting on one that went away is a 404. */
      const find = (id: string) =>
        Effect.gen(function*() {
          const service = FixId.serviceOf(id)
          if (service === undefined) return yield* Effect.fail(new HttpApiError.NotFound())
          const { detected, unavailable } = yield* detect(service)
          if (unavailable.includes(service)) return yield* Effect.fail(new FixFailed({ message: `${service} didn't answer` }))
          const found = detected.find((d) => d.fix.id === id)
          return found === undefined ? yield* Effect.fail(new HttpApiError.NotFound()) : found
        })

      const offering = (id: string, action: Fix["actions"][number]) =>
        Effect.flatMap(find(id), (found) =>
          found.fix.actions.includes(action)
            ? Effect.succeed(found)
            : Effect.fail(new InvalidFix({ message: `“${found.fix.title}” doesn't offer ${action}` })))

      /** Runs `f` with the adapter of the problem's movie or series, and its target: anything else is `refused`. */
      const onMedia = <R>(
        found: Detected,
        refused: string,
        f: <T extends MediaTarget>(adapter: MediaFixes<T>, target: T) => Effect.Effect<R, FixError> | undefined
      ): Effect.Effect<R, FixError> => withMedia(found.target, f) ?? Effect.fail(new InvalidFix({ message: refused }))

      const list = Effect.gen(function*() {
        const { detected, read: complete, unavailable } = yield* detect()
        const nowMs = yield* Clock.currentTimeMillis
        const hidden = yield* Effect.mapError(documents.list(hiddenPrefix), toOffline)
        const present = new Set(detected.map((d) => d.fix.id))
        const hiddenIds = new Set<string>()
        const stale: Array<string> = []
        for (const document of hidden) {
          const id = document.key.split("/")[2] ?? ""
          const value = decodeHidden(document.value)
          const service = FixId.serviceOf(id)
          const expired = Option.isSome(value) && value.value.until !== undefined && value.value.until <= nowMs
          // Its problem is gone (a release was grabbed, the title deleted): forget it, unless its
          // service couldn't be read this time.
          const gone = !present.has(id) && service !== undefined && complete.includes(service)
          if (Option.isNone(value) || expired || gone) stale.push(document.key)
          else if (present.has(id)) hiddenIds.add(id)
        }
        yield* Effect.forEach(stale, (key) => Effect.ignore(documents.delete(key)), { discard: true })
        return {
          items: detected.filter((d) => !hiddenIds.has(d.fix.id)).map((d) => d.fix),
          hidden: hiddenIds.size,
          unavailable
        }
      })

      /** The files of a blocked download, as the *arr's manual import matches them now, with its id. */
      const importRows = <T extends MediaTarget>(adapter: MediaFixes<T>, target: QueuedOf<T>) =>
        Effect.gen(function*() {
          if (target.downloadId === undefined) return yield* Effect.fail(new InvalidFix({ message: "This download has no id to import it by" }))
          const body = yield* write({
            service: adapter.service,
            method: "GET",
            path: `/api/v3/manualimport?downloadId=${encodeURIComponent(target.downloadId)}&filterExistingFiles=true${adapter.importHints(target)}`
          })
          const rows = readJson(ManualImportRows, body)
          if (Option.isNone(rows)) return yield* Effect.fail(new FixFailed({ message: `${adapter.service} answered something Quai can't read` }))
          return { downloadId: target.downloadId, rows: rows.value.filter((row) => row.path !== undefined && row.path !== "") }
        })

      const importPreview = <T extends MediaTarget>(adapter: MediaFixes<T>, target: QueuedOf<T>) =>
        Effect.gen(function*() {
          const files = (yield* importRows(adapter, target)).rows.map(adapter.importFile)
          const episodes = files.some((f) => f.needsEpisodes) ? yield* adapter.choices(reads, target) : []
          return { files, episodes: [...episodes] }
        })

      const importDownload = <T extends MediaTarget>(adapter: MediaFixes<T>, target: QueuedOf<T>, assignments: ImportAssignments) =>
        Effect.gen(function*() {
          const { downloadId, rows } = yield* importRows(adapter, target)
          const choices = rows.length > 0 && assignments.length > 0 ? yield* adapter.choices(reads, target) : []
          const files = yield* Effect.fromResult(importFiles(adapter, { target, downloadId, rows, assignments, choices }))
          yield* write({ service: adapter.service, method: "POST", path: "/api/v3/command", body: { name: "ManualImport", importMode: "auto", files } })
        })

      const searchReleases = <T extends MediaTarget>(adapter: MediaFixes<T>, target: MissingOf<T>) =>
        Effect.gen(function*() {
          const body = yield* write({ service: adapter.service, method: "GET", path: adapter.releaseSearch(target) }, { timeoutMs: releaseSearchTimeoutMs })
          const records = readJson(ReleaseRecords, body)
          if (Option.isNone(records)) return yield* Effect.fail(new FixFailed({ message: `${adapter.service} answered something Quai can't read` }))
          return { items: records.value.filter((r) => adapter.usable(target, r)).map(toRelease).sort(byPreference) }
        })

      const notADownload = "not a download"

      /** An action on a problem, in the journal with how it went: "Removed the download: Dune". */
      const acted = <A, E>(kind: string, what: string, found: Detected, effect: Effect.Effect<A, E>) =>
        journal.outcome({ level: "info", source: found.fix.service, kind: `fix.${kind}`, text: `${what}: ${found.fix.title}`, title: found.fix.title }, effect)

      return {
        list,

        remove: (id, blocklist) =>
          Effect.flatMap(offering(id, "remove"), (found) =>
            acted("remove", blocklist ? "Removed and blocklisted the download" : "Removed the download", found, onMedia(found, notADownload, (adapter, target) =>
              isQueued(target)
                // Never a new search: a blocklisted release is only replaced when the *arr looks again on its own.
                ? Effect.asVoid(write({
                  service: adapter.service,
                  method: "DELETE",
                  path: `/api/v3/queue/${target.queueId}?removeFromClient=true&blocklist=${blocklist}&skipRedownload=true`
                }))
                : undefined))),

        importPreview: (id) =>
          Effect.flatMap(offering(id, "importAnyway"), (found) =>
            onMedia(found, notADownload, (adapter, target) => isQueued(target) ? importPreview(adapter, target) : undefined)),

        importDownload: (id, assignments) =>
          Effect.flatMap(offering(id, "importAnyway"), (found) =>
            acted("import", "Imported the download anyway",
              found,
              onMedia(found, notADownload, (adapter, target) => isQueued(target) ? importDownload(adapter, target, assignments) : undefined)
            )),

        keep: (id) =>
          Effect.gen(function*() {
            const found = yield* offering(id, "keep")
            const { target } = found
            switch (target.kind) {
              case "candidate":
                return yield* acted("keep", "Kept, Reclaimerr won't delete it",
                  found,
                  Effect.asVoid(write({ service: "reclaimerr", method: "POST", path: protectPath(target.candidateId), body: { reason: protectReason } }))
                )
              case "removal":
                return yield* acted("keep", "Kept, Cleanuparr won't remove it", found, exclude(target))
              case "movie":
              case "series":
                return yield* Effect.fail(new InvalidFix({ message: "nothing to keep" }))
            }
          }),

        dismiss: (id) =>
          Effect.gen(function*() {
            const found = yield* offering(id, "dismiss")
            const at = yield* Clock.currentTimeMillis
            yield* acted("dismiss", "Dismissed", found, Effect.mapError(documents.put(dismissedKey(id), { at }), toOffline))
          }),

        snooze: (id, days) =>
          Effect.gen(function*() {
            const found = yield* offering(id, "snooze")
            const at = yield* Clock.currentTimeMillis
            yield* acted("snooze", days === undefined ? "Snoozed until a release is grabbed" : `Snoozed for ${days} day${days === 1 ? "" : "s"}`,
              found,
              Effect.mapError(documents.put(snoozedKey(id), days === undefined ? { at } : { at, until: at + days * 24 * 3600_000 }), toOffline)
            )
          }),

        releases: (id) =>
          Effect.flatMap(offering(id, "searchReleases"), (found) =>
            onMedia(found, "nothing to search for", (adapter, target) => isMissing(target) ? searchReleases(adapter, target) : undefined)),

        grab: (id, release) =>
          // Still without a file now: a title that got one in the meantime is no longer a problem (404).
          Effect.flatMap(offering(id, "searchReleases"), (found) =>
            acted("grab", "Grabbed a release", found, onMedia(found, "nothing to search for", (adapter, target) =>
              isMissing(target)
                ? Effect.asVoid(write({ service: adapter.service, method: "POST", path: "/api/v3/release", body: { guid: release.guid, indexerId: release.indexerId } }))
                : undefined)))
      } satisfies Fixes["Service"]
    })
  )
}
