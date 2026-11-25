import { epochSeconds, seasonOfRelease } from "../integrations/arr.ts"
import type { SeedCleanup } from "../integrations/cleanuparr.ts"
import type { FinishedTorrent } from "../integrations/qbittorrent.ts"
import type { RadarrGrabs, RadarrMovie } from "../integrations/radarr.ts"
import { type Candidate, candidateTitleKey } from "../integrations/reclaimerr.ts"
import type { SonarrGrabs, SonarrSeries } from "../integrations/sonarr.ts"
import type { SpaceBackInput, TitleKey, TorrentInput } from "./SpaceBack.ts"

/**
 * What space back is decided on, from what Upcoming read. Pure. A read is `null` when its service
 * isn't reached (nothing to know), `undefined` when it was asked and didn't answer (nothing sure).
 */
export interface SpaceReads {
  readonly now: number
  /** Reclaimerr's planned deletions. */
  readonly candidates: ReadonlyArray<Candidate>
  readonly movies: ReadonlyArray<RadarrMovie> | null | undefined
  readonly series: ReadonlyArray<SonarrSeries> | null | undefined
  readonly radarrGrabs: typeof RadarrGrabs.Type | null | undefined
  readonly sonarrGrabs: typeof SonarrGrabs.Type | null | undefined
  /** Whether Radarr's and Sonarr's imports are hardlinks: undefined when not read. */
  readonly hardlinks: { readonly movie: boolean | undefined; readonly series: boolean | undefined }
  readonly torrents: ReadonlyArray<FinishedTorrent> | null | undefined
  /** The download cleaner's plans for the torrents. */
  readonly cleanups: ReadonlyArray<SeedCleanup>
  readonly unlinkedCategory: string | undefined
}

/** The title a grab was for, as space back keys it: a series' season when the release names one. */
export const grabKey = (grab: { readonly movieId?: number | undefined; readonly seriesId?: number | undefined; readonly sourceTitle?: string | undefined }): TitleKey | undefined => {
  if (grab.movieId !== undefined) return `movie:${grab.movieId}`
  if (grab.seriesId === undefined) return undefined
  const season = grab.sourceTitle === undefined ? undefined : seasonOfRelease(grab.sourceTitle)
  return season === undefined ? `series:${grab.seriesId}` : `series:${grab.seriesId}:s${season}`
}

/** Each torrent's hash (lowercase) to the title it was grabbed for. */
export const grabsByHash = (reads: Pick<SpaceReads, "radarrGrabs" | "sonarrGrabs">): ReadonlyMap<string, TitleKey> => {
  const grabs = new Map<string, TitleKey>()
  for (const grab of [...reads.radarrGrabs ?? [], ...reads.sonarrGrabs ?? []]) {
    const key = grabKey(grab)
    if (key !== undefined && grab.downloadId) grabs.set(grab.downloadId.toLowerCase(), key)
  }
  return grabs
}

/**
 * Whether a title's files may still be in the library. Only a title Radarr or Sonarr lists with no
 * file is surely gone: one they don't list may have been removed without its files.
 */
export const libraryHolds = (reads: Pick<SpaceReads, "movies" | "series">) => (key: TitleKey): boolean => {
  const [kind, id] = key.split(":")
  if (kind === "movie") {
    const movie = reads.movies?.find((m) => m.id === Number(id))
    return movie === undefined || movie.hasFile !== false
  }
  const series = reads.series?.find((s) => s.id === Number(id))
  return series === undefined || (series.statistics?.sizeOnDisk ?? 1) > 0
}

/** The torrents as space back takes them, with what the download cleaner plans for each. */
export const torrentInputs = (torrents: ReadonlyArray<FinishedTorrent>, cleanups: ReadonlyArray<SeedCleanup>): ReadonlyArray<TorrentInput> => {
  const cleanupOf = new Map(cleanups.map((c) => [c.torrent.hash.toLowerCase(), c]))
  return torrents.map((t) => {
    const cleanup = cleanupOf.get(t.hash.toLowerCase())
    return {
      hash: t.hash,
      name: t.name,
      size: t.size,
      category: t.category,
      cleanup: cleanup === undefined ? undefined : { at: cleanup.at, timing: cleanup.timing, freesFiles: cleanup.freesFiles }
    }
  })
}

/** Space back's input. Torrents Quai can't place (a reached *arr's grabs didn't answer, qBittorrent didn't) make nothing sure. */
export const spaceInputs = (reads: SpaceReads): SpaceBackInput => {
  const placeable = reads.radarrGrabs !== undefined && reads.sonarrGrabs !== undefined
  const sources = { movies: reads.movies ?? undefined, series: reads.series ?? undefined }
  return {
    deletions: reads.candidates.map((candidate) => ({
      candidateId: candidate.id,
      title: candidate.title,
      key: candidateTitleKey(candidate, sources),
      at: Math.max((epochSeconds(candidate.auto_delete_eligible_at) ?? 0) * 1000, reads.now),
      sizeBytes: candidate.size_bytes ?? undefined
    })),
    torrents: reads.torrents === null ? [] : reads.torrents === undefined || !placeable ? undefined : torrentInputs(reads.torrents, reads.cleanups),
    grabs: grabsByHash(reads),
    inLibrary: libraryHolds(reads),
    hardlinks: reads.hardlinks,
    unlinkedCategory: reads.unlinkedCategory
  }
}
