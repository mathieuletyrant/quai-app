import {
  type EpisodeChoice,
  type Fix,
  FixFailed,
  type Fixes as FixList,
  type FixService,
  HomeOffline,
  type ImportFile,
  type ImportPreview,
  InvalidFix,
  type Releases
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpApiError } from "effect/http-api"
import { HomeDocuments, HomeLink, offlineMessage, toOffline } from "../home/HomeLink.ts"
import {
  byPreference,
  echoed,
  fileOf,
  grabLookbackMs,
  isImportBlocked,
  type ManualImportRow,
  ManualImportRows,
  qualityName,
  QueuePage,
  rejectionsOf,
  ReleaseRecords,
  serviceError,
  toRelease
} from "../integrations/arr.ts"
import { readJson } from "../integrations/Integration.ts"
import {
  blockedMovie,
  grabsSincePath,
  moviesWithoutSource,
  RadarrGrabs,
  RadarrMissing,
  radarrMissingPath,
  RadarrMovies,
  radarrQueuePath
} from "../integrations/radarr.ts"
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
import {
  blockedEpisodes,
  episodeCode,
  episodesPath,
  episodesWithoutSource,
  SonarrEpisodes,
  SonarrGrabs,
  SonarrMissing,
  sonarrMissingPath,
  sonarrQueuePath,
  SonarrSeries
} from "../integrations/sonarr.ts"
import type { Detected, FixTarget } from "./Detected.ts"

/** Where what the user hid is kept, at home: `fixes/snoozed/<fix id>`, `fixes/dismissed/<fix id>`. */
export const hiddenPrefix = "fixes/"
const snoozedKey = (id: string) => `fixes/snoozed/${id}`
const dismissedKey = (id: string) => `fixes/dismissed/${id}`

/** A snooze: until a date, or (no `until`) until the problem goes away, a release grabbed. */
const Hidden = Schema.Struct({ at: Schema.Number, until: Schema.optional(Schema.Number) })
const decodeHidden = Schema.decodeUnknownOption(Hidden)

/** The Cloud waits a little longer than Quai Home waits for the indexers. */
const releaseSearchTimeoutMs = 55_000

type FixError = HomeOffline | HttpApiError.NotFound | InvalidFix | FixFailed

/** Which service a fix id belongs to, so acting on one reads only that service again. */
const serviceOfId = (id: string): FixService | undefined =>
  id.startsWith("deletion-")
    ? "reclaimerr"
    : id.startsWith("blocked-radarr-") || id.startsWith("missing-movie-")
    ? "radarr"
    : id.startsWith("blocked-sonarr-") || id.startsWith("missing-season-")
    ? "sonarr"
    : undefined

const order: Record<Fix["kind"], number> = { scheduledDeletion: 0, noSource: 1, importBlocked: 2 }
const byUrgency = (a: Detected, b: Detected) =>
  order[a.fix.kind] - order[b.fix.kind] ||
  (a.fix.deletion?.deletesAt ?? 0) - (b.fix.deletion?.deletesAt ?? 0) ||
  (a.fix.since ?? 0) - (b.fix.since ?? 0)

interface Detection {
  readonly detected: ReadonlyArray<Detected>
  /** The services read in full this time. */
  readonly read: ReadonlyArray<FixService>
  readonly unavailable: ReadonlyArray<FixService>
}

/**
 * The To fix list (packages/api `Fixes.ts`): fixed rules run on what Quai Home reads, when asked.
 * Nothing about the problems is kept; what the user hid lives in home documents, and those whose
 * problem is gone are cleared as the list is read.
 */
export class Fixes extends Context.Service<Fixes, {
  readonly list: Effect.Effect<FixList, HomeOffline>
  readonly remove: (id: string, blocklist: boolean) => Effect.Effect<void, FixError>
  readonly importPreview: (id: string) => Effect.Effect<ImportPreview, FixError>
  readonly importDownload: (id: string, assignments: ReadonlyArray<{ readonly file: string; readonly episodeIds: ReadonlyArray<number> }>) => Effect.Effect<void, FixError>
  readonly keep: (id: string) => Effect.Effect<void, FixError>
  readonly dismiss: (id: string) => Effect.Effect<void, FixError>
  readonly snooze: (id: string, days: number | undefined) => Effect.Effect<void, FixError>
  readonly releases: (id: string) => Effect.Effect<Releases, FixError>
  readonly grab: (id: string, release: { readonly guid: string; readonly indexerId: number }) => Effect.Effect<void, FixError>
}>()("quai/Fixes") {
  static readonly layer = Layer.effect(
    Fixes,
    Effect.gen(function*() {
      const link = yield* HomeLink
      const documents = yield* HomeDocuments

      const offline = (error: { readonly message: string }) => new HomeOffline({ message: error.message })

      /** A GET's body, or None when the service didn't answer it as expected. */
      const read = <A, I>(service: FixService, path: string, schema: Schema.Codec<A, I>) =>
        link.call({ service, method: "GET", path }).pipe(
          Effect.map((r) => r.status === 200 ? readJson(schema, r.body) : Option.none()),
          Effect.tap((body) => Option.isNone(body) ? Effect.logWarning(`fixes: could not read ${service} ${path.split("?")[0]}`) : Effect.void),
          Effect.catchTag("HomeError", (error) =>
            error.reason === "offline"
              ? Effect.fail(toOffline(error))
              : Effect.as(Effect.logWarning(`fixes: ${service} ${path.split("?")[0]}: ${error.message}`), Option.none<A>()))
        )

      /** A write through Quai Home: its failure, or the service's refusal, in words. */
      const write = (request: Parameters<HomeLink["Service"]["call"]>[0], options?: Parameters<HomeLink["Service"]["call"]>[1]) =>
        link.call(request, options).pipe(
          Effect.catchTag("HomeError", (error) =>
            Effect.fail(error.reason === "offline" ? toOffline(error) : new FixFailed({ message: `Quai Home: ${error.message}` }))),
          Effect.flatMap((response) =>
            response.status >= 200 && response.status < 300
              ? Effect.succeed(response.body)
              : Effect.fail(new FixFailed({ message: serviceError(response.status, response.body) })))
        )

      const arrProblems = (service: "radarr" | "sonarr", nowMs: number) =>
        Effect.gen(function*() {
          const since = grabsSincePath(nowMs - grabLookbackMs)
          if (service === "radarr") {
            const [queue, missing, grabs] = yield* Effect.all([
              read("radarr", radarrQueuePath, QueuePage),
              read("radarr", radarrMissingPath, RadarrMissing),
              read("radarr", since, RadarrGrabs)
            ], { concurrency: "unbounded" })
            if (Option.isNone(queue) || Option.isNone(missing) || Option.isNone(grabs)) return Option.none<ReadonlyArray<Detected>>()
            const records = queue.value.records
            return Option.some([
              ...records.filter(isImportBlocked).map(blockedMovie),
              ...moviesWithoutSource(missing.value.records, records, grabs.value, nowMs)
            ])
          }
          const [queue, missing, grabs] = yield* Effect.all([
            read("sonarr", sonarrQueuePath, QueuePage),
            read("sonarr", sonarrMissingPath, SonarrMissing),
            read("sonarr", since, SonarrGrabs)
          ], { concurrency: "unbounded" })
          if (Option.isNone(queue) || Option.isNone(missing) || Option.isNone(grabs)) return Option.none<ReadonlyArray<Detected>>()
          const records = queue.value.records
          return Option.some([
            ...records.filter(isImportBlocked).map(blockedEpisodes),
            ...episodesWithoutSource(missing.value.records, records, grabs.value, nowMs)
          ])
        })

      /**
       * Reclaimerr gives no poster: its scheduled deletions take theirs from the Radarr movie or
       * Sonarr series they are, read only when one is listed (the To fix reads don't hold titles
       * with a file). Neither read can fail the list: without it, the deletion has no poster.
       */
      const deletionsWithPosters = (candidates: ReadonlyArray<Candidate>, reaches: ReadonlyArray<string>) =>
        Effect.gen(function*() {
          const due = deletionCandidates(candidates)
          const soft = <A, I>(wanted: boolean, service: "radarr" | "sonarr", path: string, schema: Schema.Codec<A, I>) =>
            wanted && reaches.includes(service)
              ? Effect.map(Effect.option(read(service, path, schema)), Option.flatten)
              : Effect.succeed(Option.none<A>())
          const [movies, series] = yield* Effect.all([
            soft(due.some(isMovie), "radarr", "/api/v3/movie", RadarrMovies),
            soft(due.some((c) => !isMovie(c)), "sonarr", "/api/v3/series", SonarrSeries)
          ], { concurrency: "unbounded" })
          return scheduledDeletions(candidates, { movies: Option.getOrUndefined(movies), series: Option.getOrUndefined(series) })
        })

      /** Runs the rules on the services asked (those Quai Home reaches). */
      const detect = (only?: FixService) =>
        Effect.gen(function*(): Effect.fn.Return<Detection, HomeOffline> {
          const home = yield* link.home
          if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
          const nowMs = yield* Clock.currentTimeMillis
          const services = (["reclaimerr", "radarr", "sonarr"] as const).filter((s) =>
            home.value.services.includes(s) && (only === undefined || only === s))
          const results = yield* Effect.forEach(services, (service) =>
            Effect.map(
              service === "reclaimerr"
                ? Effect.flatMap(read("reclaimerr", candidatesPath, CandidatePage), (page) =>
                  Option.isNone(page)
                    ? Effect.succeed(Option.none<ReadonlyArray<Detected>>())
                    : only === undefined
                    // Acting on a deletion needs no poster.
                    ? Effect.map(deletionsWithPosters(page.value.items, home.value.services), Option.some)
                    : Effect.succeed(Option.some(scheduledDeletions(page.value.items))))
                : arrProblems(service, nowMs),
              (found) => [service, found] as const
            ), { concurrency: "unbounded" })
          return {
            detected: results.flatMap(([, found]) => Option.getOrElse(found, () => [])).sort(byUrgency),
            read: results.flatMap(([service, found]) => Option.isSome(found) ? [service] : []),
            unavailable: results.flatMap(([service, found]) => Option.isNone(found) ? [service] : [])
          }
        })

      /** The problem by id, found again now: acting on one that went away is a 404. */
      const find = (id: string) =>
        Effect.gen(function*() {
          const service = serviceOfId(id)
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

      const store = (effect: Effect.Effect<void, { readonly _tag: "HomeError"; readonly message: string; readonly reason: string }>) =>
        Effect.mapError(effect, (error) => error.reason === "offline" ? offline({ message: offlineMessage }) : offline(error))

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
          const service = serviceOfId(id)
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

      const queueTarget = (target: FixTarget) =>
        target._tag === "Queue" ? Effect.succeed(target) : Effect.fail(new InvalidFix({ message: "not a download" }))

      /** The files of a blocked download, as the *arr's manual import matches them now. */
      const importRows = (target: Extract<FixTarget, { _tag: "Queue" }>) =>
        Effect.gen(function*() {
          if (target.downloadId === undefined) return yield* Effect.fail(new InvalidFix({ message: "This download has no id to import it by" }))
          const hints = target.service === "sonarr" && target.seriesId !== undefined
            ? `&seriesId=${target.seriesId}${target.seasonNumber === undefined ? "" : `&seasonNumber=${target.seasonNumber}`}`
            : ""
          const body = yield* write({
            service: target.service,
            method: "GET",
            path: `/api/v3/manualimport?downloadId=${encodeURIComponent(target.downloadId)}&filterExistingFiles=true${hints}`
          })
          const rows = readJson(ManualImportRows, body)
          if (Option.isNone(rows)) return yield* Effect.fail(new FixFailed({ message: `${target.service} answered something Quai can't read` }))
          return rows.value.filter((row) => row.path !== undefined && row.path !== "")
        })

      /** The series' episodes without a file: the only ones a file may be imported as. */
      const freeEpisodes = (seriesId: number) =>
        Effect.gen(function*() {
          const body = yield* write({ service: "sonarr", method: "GET", path: episodesPath(seriesId) })
          const episodes = Option.getOrElse(readJson(SonarrEpisodes, body), () => [])
          return episodes
            .filter((e) => e.hasFile !== true && e.seasonNumber > 0)
            .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
        })

      const toFile = (service: "radarr" | "sonarr", row: ManualImportRow): ImportFile => {
        const quality = qualityName(row.quality)
        const episodes = row.episodes ?? []
        return {
          file: fileOf(row),
          ...(row.size === undefined ? {} : { sizeBytes: row.size }),
          ...(quality === undefined ? {} : { quality }),
          episodes: episodes.map((e) => episodeCode(e.seasonNumber, e.episodeNumber)),
          needsEpisodes: service === "sonarr" && episodes.length === 0,
          rejections: rejectionsOf(row)
        }
      }

      return {
        list,

        remove: (id, blocklist) =>
          Effect.gen(function*() {
            const target = yield* Effect.flatMap(offering(id, "remove"), (found) => queueTarget(found.target))
            // Never a new search: a blocklisted release is only replaced when the *arr looks again on its own.
            yield* write({
              service: target.service,
              method: "DELETE",
              path: `/api/v3/queue/${target.queueId}?removeFromClient=true&blocklist=${blocklist}&skipRedownload=true`
            })
          }),

        importPreview: (id) =>
          Effect.gen(function*() {
            const target = yield* Effect.flatMap(offering(id, "importAnyway"), (found) => queueTarget(found.target))
            const files = (yield* importRows(target)).map((row) => toFile(target.service, row))
            const episodes: Array<EpisodeChoice> = target.service === "sonarr" && target.seriesId !== undefined && files.some((f) => f.needsEpisodes)
              ? (yield* freeEpisodes(target.seriesId)).map((e) => ({
                id: e.id,
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episodeNumber,
                ...(e.title === undefined ? {} : { title: e.title })
              }))
              : []
            return { files, episodes }
          }),

        importDownload: (id, assignments) =>
          Effect.gen(function*() {
            const target = yield* Effect.flatMap(offering(id, "importAnyway"), (found) => queueTarget(found.target))
            const rows = yield* importRows(target)
            if (rows.length === 0) return yield* Effect.fail(new InvalidFix({ message: "There's no file left to import" }))
            const downloadId = target.downloadId!
            const known = new Set(rows.map(fileOf))
            const unknown = assignments.find((a) => !known.has(a.file))
            if (unknown !== undefined) return yield* Effect.fail(new InvalidFix({ message: `${unknown.file} isn't in this download` }))

            if (target.service === "radarr") {
              const files = []
              for (const row of rows) {
                const movieId = row.movie?.id ?? target.movieId
                if (movieId === undefined) return yield* Effect.fail(new InvalidFix({ message: `Radarr doesn't know which movie ${fileOf(row)} is` }))
                // Importing over a file would replace it: the owner's rule is no upgrades.
                if (row.movie?.hasFile === true) return yield* Effect.fail(new InvalidFix({ message: "This movie already has a file" }))
                files.push({ path: row.path!, movieId, downloadId, ...echoed(row) })
              }
              yield* write({ service: "radarr", method: "POST", path: "/api/v3/command", body: { name: "ManualImport", importMode: "auto", files } })
              return
            }

            const seriesId = target.seriesId
            if (seriesId === undefined) return yield* Effect.fail(new InvalidFix({ message: "Sonarr doesn't know which series this is" }))
            const chosen = new Map(assignments.map((a) => [a.file, a.episodeIds]))
            const free = chosen.size > 0 ? yield* freeEpisodes(seriesId) : []
            const freeById = new Map(free.map((e) => [e.id, e]))
            const files = []
            for (const row of rows) {
              const file = fileOf(row)
              const picked = chosen.get(file)
              if (picked !== undefined) {
                const episodes = picked.map((episodeId) => freeById.get(episodeId))
                if (episodes.some((e) => e === undefined)) {
                  return yield* Effect.fail(new InvalidFix({ message: `Choose episodes of this series that have no file yet for ${file}` }))
                }
                const seasons = new Set(episodes.map((e) => e!.seasonNumber))
                if (seasons.size !== 1) return yield* Effect.fail(new InvalidFix({ message: `The episodes chosen for ${file} must be in one season` }))
                files.push({ path: row.path!, seriesId, seasonNumber: [...seasons][0]!, episodeIds: [...picked], downloadId, ...echoed(row) })
                continue
              }
              const matched = row.episodes ?? []
              if (matched.length === 0) return yield* Effect.fail(new InvalidFix({ message: `Choose the episode for ${file}` }))
              if (matched.some((e) => e.hasFile === true)) return yield* Effect.fail(new InvalidFix({ message: `${file} matches an episode that already has a file` }))
              files.push({
                path: row.path!,
                seriesId: row.series?.id ?? seriesId,
                seasonNumber: matched[0]!.seasonNumber,
                episodeIds: matched.map((e) => e.id),
                downloadId,
                ...echoed(row)
              })
            }
            yield* write({ service: "sonarr", method: "POST", path: "/api/v3/command", body: { name: "ManualImport", importMode: "auto", files } })
          }),

        keep: (id) =>
          Effect.gen(function*() {
            const { target } = yield* offering(id, "keep")
            if (target._tag !== "Candidate") return yield* Effect.fail(new InvalidFix({ message: "not a Reclaimerr candidate" }))
            yield* write({ service: "reclaimerr", method: "POST", path: protectPath(target.candidateId), body: { reason: protectReason } })
          }),

        dismiss: (id) =>
          Effect.gen(function*() {
            yield* offering(id, "dismiss")
            const at = yield* Clock.currentTimeMillis
            yield* store(documents.put(dismissedKey(id), { at }))
          }),

        snooze: (id, days) =>
          Effect.gen(function*() {
            yield* offering(id, "snooze")
            const at = yield* Clock.currentTimeMillis
            yield* store(documents.put(snoozedKey(id), days === undefined ? { at } : { at, until: at + days * 24 * 3600_000 }))
          }),

        releases: (id) =>
          Effect.gen(function*() {
            const { target } = yield* offering(id, "searchReleases")
            const search = target._tag === "MissingMovie"
              ? { service: "radarr" as const, path: `/api/v3/release?movieId=${target.movieId}` }
              : target._tag === "MissingEpisodes"
              ? {
                service: "sonarr" as const,
                path: target.episodeIds.length === 1
                  ? `/api/v3/release?episodeId=${target.episodeIds[0]}`
                  : `/api/v3/release?seriesId=${target.seriesId}&seasonNumber=${target.seasonNumber}`
              }
              : undefined
            if (search === undefined) return yield* Effect.fail(new InvalidFix({ message: "nothing to search for" }))
            const body = yield* write({ ...search, method: "GET" }, { timeoutMs: releaseSearchTimeoutMs })
            const records = readJson(ReleaseRecords, body)
            if (Option.isNone(records)) return yield* Effect.fail(new FixFailed({ message: `${search.service} answered something Quai can't read` }))
            // A season search also finds packs of episodes that have their file: only the releases
            // that cover nothing but missing episodes are offered, so grabbing never replaces a file.
            const missing = target._tag === "MissingEpisodes" ? new Set(target.episodeIds) : null
            const usable = missing === null
              ? records.value
              : records.value.filter((r) => {
                const ids = (r.mappedEpisodeInfo ?? []).map((e) => e.id)
                return ids.length > 0 && ids.every((episodeId) => episodeId !== undefined && missing.has(episodeId))
              })
            return { items: usable.map(toRelease).sort(byPreference) }
          }),

        grab: (id, release) =>
          Effect.gen(function*() {
            // Still without a file now: a title that got one in the meantime is no longer a problem (404).
            const { target } = yield* offering(id, "searchReleases")
            const service = target._tag === "MissingMovie" ? "radarr" : "sonarr"
            yield* write({ service, method: "POST", path: "/api/v3/release", body: { guid: release.guid, indexerId: release.indexerId } })
          })
      } satisfies Fixes["Service"]
    })
  )
}
