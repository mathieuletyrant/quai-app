import { seasonOfRelease } from "../integrations/arr.ts"
import type { SeedCleanup } from "../integrations/cleanuparr.ts"
import type { FinishedTorrent } from "../integrations/qbittorrent.ts"
import type { RadarrGrabs, RadarrMovie } from "../integrations/radarr.ts"
import { candidateTitleKey, type PlannedCandidate } from "../integrations/reclaimerr.ts"
import type { SonarrGrabs, SonarrSeries } from "../integrations/sonarr.ts"
import * as LibraryId from "../library/LibraryId.ts"
import { dueAt } from "./Rows.ts"
import type { ReleaseInput, SpaceBackInput, TitleKey, TorrentInput } from "./SpaceBack.ts"

/**
 * What space back is decided on, from what Upcoming read. Pure. A read is `null` when its service
 * isn't reached (nothing to know), `undefined` when it was asked and didn't answer (nothing sure).
 */
export interface SpaceReads {
  readonly now: number
  /** Reclaimerr's planned deletions. */
  readonly planned: ReadonlyArray<PlannedCandidate>
  readonly movies: ReadonlyArray<RadarrMovie> | null | undefined
  readonly series: ReadonlyArray<SonarrSeries> | null | undefined
  /** Each grabbing service's grabs, by service: a tool that grabs gets its key here, and every rule reads it. */
  readonly grabs: GrabReads
  /** Whether Radarr's and Sonarr's imports are hardlinks: undefined when not read. */
  readonly hardlinks: { readonly movie: boolean | undefined; readonly series: boolean | undefined }
  readonly torrents: ReadonlyArray<FinishedTorrent> | null | undefined
  /** The download cleaner's plans for the torrents. */
  readonly cleanups: ReadonlyArray<SeedCleanup>
  readonly unlinkedCategory: string | undefined
}

/** The grabs of every service that grabs; `null` when not reached, `undefined` when it didn't answer. */
export interface GrabReads {
  readonly radarr: typeof RadarrGrabs.Type | null | undefined
  readonly sonarr: typeof SonarrGrabs.Type | null | undefined
}

/** Every grab of every service, whatever the service: the one list the rules below go through. */
const allGrabs = (grabs: GrabReads) => Object.values(grabs).flatMap((list) => list ?? [])

/** The title a grab was for, as space back keys it: a series' season when the release names one. */
export const grabKey = (
  grab: {
    readonly movieId?: number | undefined
    readonly seriesId?: number | undefined
    readonly sourceTitle?: string | undefined
  }
): TitleKey | undefined => {
  if (grab.movieId !== undefined) return LibraryId.movie(grab.movieId)
  if (grab.seriesId === undefined) return undefined
  const season = grab.sourceTitle === undefined ? undefined : seasonOfRelease(grab.sourceTitle)
  return season === undefined ? LibraryId.series(grab.seriesId) : LibraryId.season(grab.seriesId, season)
}

/** Each torrent's hash (lowercase) to the title it was grabbed for. */
export const grabsByHash = (reads: GrabReads): ReadonlyMap<string, TitleKey> => {
  const grabs = new Map<string, TitleKey>()
  for (const grab of allGrabs(reads)) {
    const key = grabKey(grab)
    if (key !== undefined && grab.downloadId) grabs.set(grab.downloadId.toLowerCase(), key)
  }
  return grabs
}

/** Each release grabbed, with its title, name and listed size: what a cross-seed is matched to. */
export const releasesOf = (reads: GrabReads): ReadonlyArray<ReleaseInput> =>
  allGrabs(reads).flatMap((grab) => {
    const key = grabKey(grab)
    if (key === undefined || !grab.sourceTitle) return []
    const size = Number(grab.data?.size ?? Number.NaN)
    return [{ key, name: grab.sourceTitle, size: Number.isFinite(size) ? size : undefined }]
  })

/**
 * Whether a title's files may still be in the library. Only a title Radarr or Sonarr lists with no
 * file is surely gone: one they don't list may have been removed without its files.
 */
export const libraryHolds = (reads: Pick<SpaceReads, "movies" | "series">) => {
  const movies = byId(reads.movies ?? [])
  const series = byId(reads.series ?? [])
  return (key: TitleKey): boolean => {
    const parsed = LibraryId.parse(key)
    if (parsed === undefined) return true
    if (parsed.kind === "movie") {
      const movie = movies.get(parsed.id)
      return movie === undefined || movie.hasFile !== false
    }
    const show = series.get(parsed.id)
    return show === undefined || (show.statistics?.sizeOnDisk ?? 1) > 0
  }
}

/** A list by id, the first of each id, as `find` would. */
const byId = <A extends { readonly id: number }>(list: ReadonlyArray<A>): ReadonlyMap<number, A> => {
  const found = new Map<number, A>()
  for (const item of list) if (!found.has(item.id)) found.set(item.id, item)
  return found
}

/** The torrents as space back takes them, with what the download cleaner plans for each. */
export const torrentInputs = (
  torrents: ReadonlyArray<FinishedTorrent>,
  cleanups: ReadonlyArray<SeedCleanup>
): ReadonlyArray<TorrentInput> => {
  const cleanupOf = new Map(cleanups.map((cleanup) => [cleanup.torrent.hash.toLowerCase(), cleanup]))
  return torrents.map((torrent) => {
    const cleanup = cleanupOf.get(torrent.hash.toLowerCase())
    return {
      hash: torrent.hash,
      name: torrent.name,
      size: torrent.size,
      category: torrent.category,
      cleanup: cleanup === undefined
        ? undefined
        : { at: cleanup.at, timing: cleanup.timing, freesFiles: cleanup.freesFiles }
    }
  })
}

/** Space back's input. Torrents Quai can't place (a reached *arr's grabs didn't answer, qBittorrent didn't) make nothing sure. */
export const spaceInputs = (reads: SpaceReads): SpaceBackInput => {
  const placeable = Object.values(reads.grabs).every((list) => list !== undefined)
  const sources = { movies: reads.movies ?? undefined, series: reads.series ?? undefined }
  return {
    deletions: reads.planned.map((planned) => ({
      candidateId: planned.candidate.id,
      title: planned.candidate.title,
      key: candidateTitleKey(planned, sources),
      at: dueAt(planned.deletesAt, reads.now) * 1000,
      sizeBytes: planned.candidate.size_bytes ?? undefined
    })),
    torrents: reads.torrents === null
      ? []
      : reads.torrents === undefined || !placeable
      ? undefined
      : torrentInputs(reads.torrents, reads.cleanups),
    grabs: grabsByHash(reads.grabs),
    releases: releasesOf(reads.grabs),
    inLibrary: libraryHolds(reads),
    hardlinks: reads.hardlinks,
    unlinkedCategory: reads.unlinkedCategory
  }
}
