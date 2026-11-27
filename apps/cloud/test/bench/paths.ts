/**
 * The pure computations behind each screen, called as the services call them, on a big home: what
 * the scale tests (`test/scale.test.ts`) and the benchmarks (`*.bench.ts`) time. `prepare` makes the
 * input from the home's lists (not timed), `run` is the computation.
 */
import { HomeProtocol, type LibraryItem, upcomingReleaseDays } from "@quai/api"
import { blockedMovie, moviesWithoutSource, queuedMovie } from "@quai/domain/fixes/movies.ts"
import { blockedEpisodes, episodesWithoutSource, queuedEpisodes } from "@quai/domain/fixes/series.ts"
import { isImportBlocked } from "@quai/domain/integrations/arr.ts"
import {
  queuedByDownload,
  seedCleanups,
  stuckRemovals,
  unlinkedCategory
} from "@quai/domain/integrations/cleanuparr.ts"
import { libraryMovie } from "@quai/domain/integrations/radarr.ts"
import { plannedDeletionFixes, plannedDeletions } from "@quai/domain/integrations/reclaimerr.ts"
import { librarySeries } from "@quai/domain/integrations/sonarr.ts"
import { rangeReleases } from "@quai/domain/releases/ReleaseDays.ts"
import { plannedDeletionItems, releaseItems, seedItems } from "@quai/domain/upcoming/Rows.ts"
import { spaceBack } from "@quai/domain/upcoming/SpaceBack.ts"
import { spaceInputs, type SpaceReads } from "@quai/domain/upcoming/SpaceInputs.ts"
import { type Gathered, plansOf, reachOf, type StackReads, upcomingOf } from "@quai/domain/upcoming/Upcoming.ts"
import { Option } from "effect"
import { type BigHome, bigHome, recordedAt, recordedDay, recordedZone } from "../bigHome.ts"

export interface Path<I = any> {
  readonly prepare: (home: BigHome) => I
  readonly run: (input: I) => unknown
}

const path = <I>(prepare: (home: BigHome) => I, run: (input: I) => unknown): Path<I> => ({ prepare, run })

const now = recordedAt
const zone = recordedZone
/** The download cleaner's next run: five minutes after the recording. */
const nextRunAt = now + 5 * 60_000

const removalsOf = (home: BigHome) =>
  stuckRemovals({
    downloads: home.strikes,
    settings: home.queueCleaner,
    stallRules: home.stallRules,
    slowRules: home.slowRules,
    nextRunAt: Math.floor(nextRunAt / 1000),
    queued: queuedByDownload([
      { queued: queuedMovie, records: home.radarrQueue },
      { queued: queuedEpisodes, records: home.sonarrQueue }
    ])
  })

const cleanupsOf = (home: BigHome) =>
  seedCleanups({ settings: home.downloadCleaner, torrents: home.torrents, nextRunAt, now })

const spaceReadsOf = (home: BigHome): SpaceReads => ({
  now,
  planned: plannedDeletions(home.candidates, undefined),
  movies: home.movies,
  series: home.series,
  grabs: { radarr: home.radarrGrabs, sonarr: home.sonarrGrabs },
  hardlinks: { movie: true, series: true },
  torrents: home.torrents,
  cleanups: cleanupsOf(home),
  unlinkedCategory: unlinkedCategory(home.downloadCleaner)
})

const everything: ReadonlyArray<HomeProtocol.HomeService> = [
  "radarr",
  "sonarr",
  "reclaimerr",
  "cleanuparr",
  "qbittorrent"
]

/** What Upcoming reads of the home, every service reached and answering. */
export const gatheredOf = (home: BigHome): Gathered => {
  const stack: StackReads = {
    calendars: {
      values: { episodes: Option.some(home.sonarrCalendar), movies: Option.some(home.radarrCalendar) },
      unavailable: []
    },
    candidates: Option.some({ items: home.candidates }),
    deletionTask: undefined,
    removals: Option.some(removalsOf(home)),
    cleaner: Option.some(home.downloadCleaner),
    job: Option.some({ nextRunTime: new Date(nextRunAt).toISOString() }),
    finished: Option.some(home.torrents)
  }
  const hardlinks = Option.some({ copyUsingHardlinks: true })
  return {
    reach: reachOf({ services: everything }),
    zone,
    today: recordedDay,
    now,
    stack,
    plans: plansOf(stack, now),
    library: {
      movies: Option.some(home.movies),
      series: Option.some(home.series),
      radarrGrabs: Option.some(home.radarrGrabs),
      sonarrGrabs: Option.some(home.sonarrGrabs),
      radarrSettings: hardlinks,
      sonarrSettings: hardlinks
    }
  }
}

const newestFirst = (left: LibraryItem, right: LibraryItem) =>
  (right.addedAt ?? 0) - (left.addedAt ?? 0) || left.title.localeCompare(right.title)

export const paths = {
  /** Upcoming: the releases of the next 14 days, as rows. */
  releases: path(
    (home) => ({ episodes: home.sonarrCalendar, movies: home.radarrCalendar }),
    (inputs) => releaseItems(rangeReleases(recordedDay, upcomingReleaseDays, zone, inputs), zone)
  ),
  /** Upcoming and To fix: Reclaimerr's planned deletions, their posters found in Radarr and Sonarr. */
  plannedDeletions: path(
    (home) => home,
    (home) =>
      plannedDeletionItems(
        plannedDeletionFixes(plannedDeletions(home.candidates, undefined), {
          movies: home.movies,
          series: home.series
        }),
        now,
        new Map()
      )
  ),
  /** Upcoming: the space each planned deletion and seed cleanup gives back. */
  spaceBack: path(spaceReadsOf, (reads) => spaceBack(spaceInputs(reads))),
  /** Upcoming: when the download cleaner takes each finished torrent, as rows. */
  seedCleanups: path((home) => home, (home) => seedItems(cleanupsOf(home), zone, new Map())),
  /** Upcoming, the whole list from what was read. */
  upcoming: path(gatheredOf, upcomingOf),
  /** To fix: movies out with no release grabbed. */
  moviesWithoutSource: path(
    (home) => home,
    (home) => moviesWithoutSource(home.radarrMissing, home.radarrQueue, home.radarrGrabs, now)
  ),
  /** To fix: aired episodes with no release grabbed. */
  episodesWithoutSource: path(
    (home) => home,
    (home) => episodesWithoutSource(home.sonarrMissing, home.sonarrQueue, home.sonarrGrabs, now)
  ),
  /** To fix and Upcoming: the downloads Cleanuparr removes at its next strike. */
  stuckRemovals: path((home) => home, removalsOf),
  /** To fix: finished downloads Radarr and Sonarr won't import. */
  blockedImports: path((home) => home, (home) => [
    ...home.radarrQueue.filter(isImportBlocked).map(blockedMovie),
    ...home.sonarrQueue.filter(isImportBlocked).map(blockedEpisodes)
  ]),
  /** Library: every movie and series, newest first. */
  library: path(
    (home) => home,
    (home) =>
      [...home.movies.map((movie) => libraryMovie(movie)), ...home.series.map((show) => librarySeries(show))]
        .sort(newestFirst)
  )
} satisfies Record<string, Path>

/**
 * A big home as Quai reads it: about 10 000 movies, 2 000 series and 5 000 finished torrents, with
 * the pages Quai reads cut where it cuts them (1 000 missing movies, 200 candidates, 500 strikes).
 */
export const realisticHome = (): BigHome => {
  const home = bigHome({ radarr: 3334, sonarr: 667, qbittorrent: 2500, reclaimerr: 67, cleanuparr: 84 })
  return { ...home, radarrMissing: home.radarrMissing.slice(0, 1000) }
}

/** How each benchmark runs: a few runs are enough for numbers in milliseconds. */
export const benchOptions = { time: 500, iterations: 5, warmupIterations: 1, warmupTime: 0 }
