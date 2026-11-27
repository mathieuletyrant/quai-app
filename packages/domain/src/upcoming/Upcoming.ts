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
import { HomeLink, type LinkedHome, offlineMessage } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { HomeTime } from "../home/HomeTime.ts"
import { epochSeconds, mediaManagementRead } from "../integrations/arr.ts"
import {
  downloadCleanerJobRead,
  downloadCleanerRead,
  type SeedCleanup,
  seedCleanups,
  unlinkedCategory
} from "../integrations/cleanuparr.ts"
import { finishedTorrentsRead } from "../integrations/qbittorrent.ts"
import { radarrGrabsRead, radarrMoviesRead } from "../integrations/radarr.ts"
import {
  candidatesRead,
  type PlannedCandidate,
  plannedDeletionFixes,
  plannedDeletions,
  readDeletionTask
} from "../integrations/reclaimerr.ts"
import { sonarrGrabsRead, sonarrSeriesRead } from "../integrations/sonarr.ts"
import { type DayReads, rangeReads, rangeReleases } from "../releases/ReleaseDays.ts"
import { byDate, plannedDeletionItems, releaseItems, seedItems, stuckRemovalItems } from "./Rows.ts"
import { type SpaceBack, spaceBack } from "./SpaceBack.ts"
import { spaceInputs } from "./SpaceInputs.ts"

/** A torrent older than this is never looked up in the *arr history. */
export const maxGrabLookbackMs = 400 * 24 * 3600_000

/** How far back the grabs are read: a day before the oldest torrent (epoch seconds added), at most `maxGrabLookbackMs`. */
export const grabsSince = (addedOn: ReadonlyArray<number>, now: number) =>
  Math.max(Math.min(now, ...addedOn.map((seconds) => seconds * 1000)) - 24 * 3600_000, now - maxGrabLookbackMs)

/** A read's value as space back takes it: `null` when its service isn't reached, `undefined` when it didn't answer. */
const known = <A>(reached: boolean, value: Option.Option<A>): A | null | undefined =>
  reached ? Option.getOrUndefined(value) : null

const nothingBack: SpaceBack = { deletions: new Map<number, number>(), torrents: new Map<string, number>() }

/** What the linked Quai Home lets Upcoming read. */
export interface Reach {
  readonly has: (service: HomeProtocol.HomeService) => boolean
  /** A Quai Home recent enough to read the download cleaner and the media management setting. */
  readonly recent: boolean
  /** Seed cleanups can be planned: Cleanuparr and qBittorrent reached by a recent Quai Home. */
  readonly cleaning: boolean
}

export const reachOf = (home: Pick<LinkedHome, "services" | "protocol">): Reach => {
  const has = (service: HomeProtocol.HomeService) => home.services.includes(service)
  // An older Quai Home refuses the download cleaner and the media management setting.
  const recent = home.protocol >= HomeProtocol.upcomingProtocolVersion
  return { has, recent, cleaning: recent && has("cleanuparr") && has("qbittorrent") }
}

/** The reads Upcoming always makes, at once: the calendars, and what each service plans to remove. */
const readStack = (reads: HomeReads["Service"], reach: Reach, calendar: DayReads) => {
  const none = Effect.succeed(Option.none<never>())
  return Effect.all({
    calendars: reads.all({ episodes: calendar.episodes, movies: calendar.movies }),
    candidates: reach.has("reclaimerr") ? reads.read(candidatesRead) : none,
    deletionTask: reach.has("reclaimerr") ? readDeletionTask(reads) : Effect.succeed(undefined),
    removals: reach.has("cleanuparr") ? stuckRemovalsRead(reads) : none,
    cleaner: reach.cleaning ? reads.read(downloadCleanerRead) : none,
    job: reach.cleaning ? reads.read(downloadCleanerJobRead) : none,
    finished: reach.has("qbittorrent") ? reads.read(finishedTorrentsRead) : none
  }, { concurrency: "unbounded" })
}

export type StackReads = Effect.Success<ReturnType<typeof readStack>>

/** The library, its grabs since `since` and its hardlink settings: what space back is decided on. */
const readLibrary = (reads: HomeReads["Service"], reach: Reach, since: number) =>
  reads.all({
    movies: reach.has("radarr") ? radarrMoviesRead : null,
    series: reach.has("sonarr") ? sonarrSeriesRead : null,
    radarrGrabs: reach.has("radarr") ? radarrGrabsRead(since) : null,
    sonarrGrabs: reach.has("sonarr") ? sonarrGrabsRead(since) : null,
    radarrSettings: reach.recent && reach.has("radarr") ? mediaManagementRead("radarr") : null,
    sonarrSettings: reach.recent && reach.has("sonarr") ? mediaManagementRead("sonarr") : null
  }, { optional: ["movies", "series", "radarrGrabs", "sonarrGrabs", "radarrSettings", "sonarrSettings"] }).pipe(
    Effect.map(({ values }) => values)
  )

export type LibraryReads = Effect.Success<ReturnType<typeof readLibrary>>

/** What frees space: Reclaimerr's planned deletions and the download cleaner's seed cleanups. */
export interface Plans {
  readonly planned: ReadonlyArray<PlannedCandidate>
  readonly cleanups: ReadonlyArray<SeedCleanup>
}

/** Epoch milliseconds of the download cleaner's next run, when scheduled. */
const nextRunOf = (job: StackReads["job"]): number | undefined => {
  const seconds = Option.getOrUndefined(
    Option.flatMap(job, (scheduled) => Option.fromNullishOr(epochSeconds(scheduled.nextRunTime ?? undefined)))
  )
  return seconds === undefined ? undefined : seconds * 1000
}

/** What the download cleaner plans for the finished torrents. */
const cleanupsOf = (stack: Pick<StackReads, "cleaner" | "finished" | "job">, now: number) => {
  const { cleaner, finished } = stack
  return Option.isSome(cleaner) && Option.isSome(finished)
    ? seedCleanups({ settings: cleaner.value, torrents: finished.value, nextRunAt: nextRunOf(stack.job), now })
    : []
}

export const plansOf = (stack: StackReads, now: number): Plans => ({
  planned: Option.match(stack.candidates, {
    onNone: () => [],
    onSome: (page) => plannedDeletions(page.items, stack.deletionTask)
  }),
  cleanups: cleanupsOf(stack, now)
})

/** Space back is only decided when something plans to free space: the library is read for it. */
const freesSpace = (plans: Plans) => plans.planned.length > 0 || plans.cleanups.length > 0

/** When each finished torrent was added, epoch seconds. */
const addedOnOf = (finished: StackReads["finished"]) =>
  Option.match(finished, { onNone: () => [], onSome: (list) => list.flatMap((torrent) => torrent.added_on ?? []) })

/** Everything Upcoming read, as it is put together. */
export interface Gathered {
  readonly reach: Reach
  readonly zone: string
  readonly today: string
  readonly now: number
  readonly stack: StackReads
  readonly plans: Plans
  /** Undefined when nothing frees space, so it wasn't read. */
  readonly library: LibraryReads | undefined
}

const hardlinksOf = (library: LibraryReads) => ({
  movie: Option.getOrUndefined(Option.map(library.radarrSettings, (settings) => settings.copyUsingHardlinks)),
  series: Option.getOrUndefined(Option.map(library.sonarrSettings, (settings) => settings.copyUsingHardlinks))
})

/** What space back is decided on: the plans, the torrents and the download cleaner's settings, the library. */
interface SpaceSources {
  readonly reach: Reach
  readonly now: number
  readonly plans: Plans
  readonly stack: Pick<StackReads, "finished" | "cleaner">
  readonly library: LibraryReads | undefined
}

/** The space each planned deletion and seed cleanup gives back. */
export const spaceFreed = ({ library, now, plans, reach, stack }: SpaceSources): SpaceBack => {
  if (library === undefined) return nothingBack
  return spaceBack(spaceInputs({
    now,
    planned: plans.planned,
    movies: known(reach.has("radarr"), library.movies),
    series: known(reach.has("sonarr"), library.series),
    grabs: {
      radarr: known(reach.has("radarr"), library.radarrGrabs),
      sonarr: known(reach.has("sonarr"), library.sonarrGrabs)
    },
    hardlinks: hardlinksOf(library),
    torrents: known(reach.has("qbittorrent"), stack.finished),
    cleanups: plans.cleanups,
    unlinkedCategory: Option.getOrUndefined(Option.map(stack.cleaner, unlinkedCategory))
  }))
}

const postersOf = (library: LibraryReads | undefined) =>
  library === undefined
    ? {}
    : { movies: Option.getOrUndefined(library.movies), series: Option.getOrUndefined(library.series) }

/** The services reached that didn't answer, in the order the app shows them. */
export const unavailableOf = ({ reach, stack }: Pick<Gathered, "reach" | "stack">): Array<UpcomingService> => {
  const cleanuparrDown = Option.isNone(stack.removals) || (reach.cleaning && Option.isNone(stack.cleaner))
  const down: ReadonlyArray<readonly [UpcomingService, boolean]> = [
    ["radarr", stack.calendars.unavailable.includes("radarr")],
    ["sonarr", stack.calendars.unavailable.includes("sonarr")],
    ["reclaimerr", reach.has("reclaimerr") && Option.isNone(stack.candidates)],
    ["cleanuparr", reach.has("cleanuparr") && cleanuparrDown],
    ["qbittorrent", reach.has("qbittorrent") && Option.isNone(stack.finished)]
  ]
  return down.flatMap(([service, isDown]) => isDown ? [service] : [])
}

/** Upcoming's rows, by date, from what was read. Pure. */
export const upcomingOf = (gathered: Gathered): UpcomingList => {
  const { library, now, plans, reach, stack, today, zone } = gathered
  const frees = spaceFreed(gathered)
  const releases = rangeReleases(today, upcomingReleaseDays, zone, {
    episodes: Option.getOrUndefined(stack.calendars.values.episodes),
    movies: Option.getOrUndefined(stack.calendars.values.movies)
  })
  return {
    timeZone: zone,
    items: [
      ...releaseItems(releases, zone),
      ...plannedDeletionItems(plannedDeletionFixes(plans.planned, postersOf(library)), now, frees.deletions),
      ...stuckRemovalItems(Option.getOrElse(stack.removals, () => []), now),
      ...seedItems(plans.cleanups, zone, frees.torrents)
    ].sort(byDate),
    unavailable: unavailableOf(gathered),
    homeOutdated: !reach.recent && (reach.has("cleanuparr") || reach.has("reclaimerr"))
  }
}

/**
 * The space a deletion Reclaimerr has just carried out gave back (Gone), read now: as Upcoming would
 * have said it, with the deletion due now. Undefined when not sure: a torrent still seeds the files,
 * the title isn't found anymore, its size was never read.
 */
export const spaceBackOfCarriedOut = (
  reads: HomeReads["Service"],
  reach: Reach,
  planned: PlannedCandidate,
  now: number
): Effect.Effect<number | undefined, HomeOffline> =>
  Effect.gen(function*() {
    const none = Effect.succeed(Option.none<never>())
    const stack = yield* Effect.all({
      cleaner: reach.cleaning ? reads.read(downloadCleanerRead) : none,
      job: reach.cleaning ? reads.read(downloadCleanerJobRead) : none,
      finished: reach.has("qbittorrent") ? reads.read(finishedTorrentsRead) : none
    }, { concurrency: "unbounded" })
    const library = yield* readLibrary(reads, reach, grabsSince(addedOnOf(stack.finished), now))
    const plans = { planned: [planned], cleanups: cleanupsOf(stack, now) }
    return spaceFreed({ reach, now, plans, stack, library }).deletions.get(planned.candidate.id)
  })

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
        const reach = reachOf(home.value)
        const stack = yield* readStack(reads, reach, rangeReads(today, upcomingReleaseDays, zone))
        const plans = plansOf(stack, now)
        const library = freesSpace(plans)
          ? yield* readLibrary(reads, reach, grabsSince(addedOnOf(stack.finished), now))
          : undefined
        return upcomingOf({ reach, zone, today, now, stack, plans, library })
      })

      return { list }
    })
  )
}
