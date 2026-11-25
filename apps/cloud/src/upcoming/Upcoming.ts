import {
  HomeOffline,
  HomeProtocol,
  type Upcoming as UpcomingList,
  upcomingReleaseDays,
  type UpcomingService
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { stuckRemovalsRead } from "../fixes/Planned.ts"
import { dayOf } from "../home/Day.ts"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { HomeTime } from "../home/HomeTime.ts"
import { epochSeconds, mediaManagementRead } from "../integrations/arr.ts"
import {
  downloadCleanerJobRead,
  downloadCleanerRead,
  seedCleanups,
  unlinkedCategory
} from "../integrations/cleanuparr.ts"
import { finishedTorrentsRead } from "../integrations/qbittorrent.ts"
import { radarrGrabsRead, radarrMoviesRead } from "../integrations/radarr.ts"
import { candidatesRead, plannedDeletionFixes, plannedDeletions } from "../integrations/reclaimerr.ts"
import { sonarrGrabsRead, sonarrSeriesRead } from "../integrations/sonarr.ts"
import { rangeReads, rangeReleases } from "../releases/ReleaseDays.ts"
import { byDate, plannedDeletionItems, releaseItems, seedItems, stuckRemovalItems } from "./Rows.ts"
import { spaceBack } from "./SpaceBack.ts"
import { spaceInputs } from "./SpaceInputs.ts"

/** A torrent older than this is never looked up in the *arr history. */
export const maxGrabLookbackMs = 400 * 24 * 3600_000

/** How far back the grabs are read: a day before the oldest torrent (epoch seconds added), at most `maxGrabLookbackMs`. */
export const grabsSince = (addedOn: ReadonlyArray<number>, now: number) =>
  Math.max(Math.min(now, ...addedOn.map((seconds) => seconds * 1000)) - 24 * 3600_000, now - maxGrabLookbackMs)

/** A read's value as space back takes it: `null` when its service isn't reached, `undefined` when it didn't answer. */
const known = <A>(reached: boolean, value: Option.Option<A>): A | null | undefined =>
  reached ? Option.getOrUndefined(value) : null

const nothingBack = { deletions: new Map<number, number>(), torrents: new Map<string, number>() }

/**
 * Upcoming (docs/upcoming.md): what the stack will do on its own, read when the app asks, nothing
 * kept. This only reads and puts together: the rows are made in `Rows.ts`, the space that comes
 * back is decided in `SpaceBack.ts` from what `SpaceInputs.ts` makes of the reads.
 */
export class Upcoming extends Context.Service<Upcoming, {
  readonly list: Effect.Effect<UpcomingList, HomeOffline>
}>()("quai/Upcoming") {
  static readonly layer = Layer.effect(
    Upcoming,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const link = yield* HomeLink
      const time = yield* HomeTime

      const list = Effect.gen(function*(): Effect.fn.Return<UpcomingList, HomeOffline> {
        const home = yield* link.home
        if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
        const zone = yield* time.zone
        const now = yield* Clock.currentTimeMillis
        const today = dayOf(now, zone)
        const has = (service: HomeProtocol.HomeService) => home.value.services.includes(service)
        // An older Quai Home refuses the download cleaner and the media management setting.
        const recent = home.value.protocol >= HomeProtocol.upcomingProtocolVersion
        const cleaning = recent && has("cleanuparr") && has("qbittorrent")
        const none = Effect.succeed(Option.none<never>())

        const calendar = rangeReads(today, upcomingReleaseDays, zone)
        const [calendars, candidates, removals, cleaner, job, finished] = yield* Effect.all([
          reads.all({ episodes: calendar.episodes, movies: calendar.movies }),
          has("reclaimerr") ? reads.read(candidatesRead) : none,
          has("cleanuparr") ? stuckRemovalsRead(reads) : none,
          cleaning ? reads.read(downloadCleanerRead) : none,
          cleaning ? reads.read(downloadCleanerJobRead) : none,
          has("qbittorrent") ? reads.read(finishedTorrentsRead) : none
        ], { concurrency: "unbounded" })
        const planned = Option.match(candidates, { onNone: () => [], onSome: (page) => plannedDeletions(page.items) })
        const nextRunAt = Option.getOrUndefined(
          Option.flatMap(job, (scheduled) => Option.fromNullishOr(epochSeconds(scheduled.nextRunTime ?? undefined)))
        )
        const cleanups = Option.isSome(cleaner) && Option.isSome(finished)
          ? seedCleanups({
            settings: cleaner.value,
            torrents: finished.value,
            nextRunAt: nextRunAt === undefined ? undefined : nextRunAt * 1000,
            now
          })
          : []

        const addedOn = Option.match(finished, {
          onNone: () => [],
          onSome: (list) => list.flatMap((torrent) => torrent.added_on ?? [])
        })
        const since = grabsSince(addedOn, now)
        const library = planned.length > 0 || cleanups.length > 0
          ? (yield* reads.all({
            movies: has("radarr") ? radarrMoviesRead : null,
            series: has("sonarr") ? sonarrSeriesRead : null,
            radarrGrabs: has("radarr") ? radarrGrabsRead(since) : null,
            sonarrGrabs: has("sonarr") ? sonarrGrabsRead(since) : null,
            radarrSettings: recent && has("radarr") ? mediaManagementRead("radarr") : null,
            sonarrSettings: recent && has("sonarr") ? mediaManagementRead("sonarr") : null
          }, { optional: ["movies", "series", "radarrGrabs", "sonarrGrabs", "radarrSettings", "sonarrSettings"] }))
            .values
          : undefined
        const frees = library === undefined ? nothingBack : spaceBack(spaceInputs({
          now,
          planned,
          movies: known(has("radarr"), library.movies),
          series: known(has("sonarr"), library.series),
          radarrGrabs: known(has("radarr"), library.radarrGrabs),
          sonarrGrabs: known(has("sonarr"), library.sonarrGrabs),
          hardlinks: {
            movie: Option.getOrUndefined(Option.map(library.radarrSettings, (settings) => settings.copyUsingHardlinks)),
            series: Option.getOrUndefined(Option.map(library.sonarrSettings, (settings) => settings.copyUsingHardlinks))
          },
          torrents: known(has("qbittorrent"), finished),
          cleanups,
          unlinkedCategory: Option.getOrUndefined(Option.map(cleaner, unlinkedCategory))
        }))
        const posters = library === undefined
          ? {}
          : { movies: Option.getOrUndefined(library.movies), series: Option.getOrUndefined(library.series) }

        const unavailable: Array<UpcomingService> = []
        if (calendars.unavailable.includes("radarr")) unavailable.push("radarr")
        if (calendars.unavailable.includes("sonarr")) unavailable.push("sonarr")
        if (has("reclaimerr") && Option.isNone(candidates)) unavailable.push("reclaimerr")
        if (has("cleanuparr") && (Option.isNone(removals) || (cleaning && Option.isNone(cleaner)))) {
          unavailable.push("cleanuparr")
        }
        if (has("qbittorrent") && Option.isNone(finished)) unavailable.push("qbittorrent")

        return {
          timeZone: zone,
          items: [
            ...releaseItems(
              rangeReleases(today, upcomingReleaseDays, zone, {
                episodes: Option.getOrUndefined(calendars.values.episodes),
                movies: Option.getOrUndefined(calendars.values.movies)
              }),
              zone
            ),
            ...plannedDeletionItems(plannedDeletionFixes(planned, posters), now, frees.deletions),
            ...stuckRemovalItems(Option.getOrElse(removals, () => []), now),
            ...seedItems(cleanups, zone, frees.torrents)
          ].sort(byDate),
          unavailable,
          homeOutdated: !recent && (has("cleanuparr") || has("reclaimerr"))
        }
      })

      return { list }
    })
  )
}
