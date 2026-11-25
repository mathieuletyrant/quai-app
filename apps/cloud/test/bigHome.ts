/**
 * A big home, made of the responses recorded from a real one (fixtures/real, see real.test.ts)
 * copied many times over: each copy has its own ids, TMDB and TVDB ids, titles and download hashes,
 * and points to itself (a copy's grab to the copy's movie and torrent, its strike to its queue row,
 * its candidate to its own titles). Copy 0 keeps the recorded ids. Decoded with the schemas Quai
 * reads them with. For the scale tests and benchmarks: `bigHome(250)`, or a count of copies per
 * service.
 *
 * What the recording doesn't hold is taken from the fixtures written from the services' documented
 * payloads: the queues and Cleanuparr's strikes (the home had none), the download cleaner's settings.
 * The recorded candidates are titles cut from the recorded library: each copy's candidates are tied,
 * in turn, to that copy's movies and series by TMDB id, so the joins find something.
 */
import { Schema } from "effect"
import { QueuePage } from "../src/integrations/arr.ts"
import {
  DownloadCleanerSettings,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead
} from "../src/integrations/cleanuparr.ts"
import { finishedTorrentsRead } from "../src/integrations/qbittorrent.ts"
import { RadarrCalendar, RadarrGrabs, RadarrMissing, RadarrMovies } from "../src/integrations/radarr.ts"
import { candidatesRead } from "../src/integrations/reclaimerr.ts"
import { SonarrCalendar, SonarrEpisodes, SonarrGrabs, SonarrMissing, SonarrSeries } from "../src/integrations/sonarr.ts"
import { fixture } from "./fixtures.ts"

type Json = Record<string, any>

/** How many copies of each service's lists. */
export interface Copies {
  /** Movies, missing movies, grabs, the calendar, the queue. */
  readonly radarr: number
  /** Series, missing episodes, grabs, episodes, the calendar, the queue. */
  readonly sonarr: number
  /** Finished torrents. */
  readonly qbittorrent: number
  /** Cleanup candidates. */
  readonly reclaimerr: number
  /** Strikes (on the queues' downloads). */
  readonly cleanuparr: number
}

const idStride = 1_000_000
const externalIdStride = 10_000_000

const id = (value: number, copy: number) => value + copy * idStride
const externalId = (value: number | null | undefined, copy: number) =>
  value === null || value === undefined || value === 0 ? value : value + copy * externalIdStride
const nullableId = (value: number | null | undefined, copy: number) =>
  value === null || value === undefined ? value : id(value, copy)
const tag = (copy: number) => `k${copy}`
/** "Runner" → "Runner k3": the copy's word, so its titles and names stay apart and still match each other. */
const title = (value: string, copy: number) => copy === 0 ? value : `${value} ${tag(copy)}`
/** A release or torrent name, "k3.Notre.maison.2022.S01…": the season and the extension stay where they were. */
const release = (value: string | undefined, copy: number) =>
  value === undefined || copy === 0 ? value : `${tag(copy)}.${value}`
const prefix = (copy: number) => copy.toString(16).padStart(8, "0")
/** A download hash (or a UUID) of its own per copy, in the case it was written in. */
export const hashOf = <S extends string | null | undefined>(hash: S, copy: number): S => {
  if (hash === null || hash === undefined || hash === "" || copy === 0) return hash
  const copied = `${prefix(copy)}${hash.slice(8)}`
  return (hash === hash.toUpperCase() ? copied.toUpperCase() : copied) as S
}

/** `copies` copies of a list, copy after copy: `make` gives an item's copy number `copy`. */
const copied = <T>(list: ReadonlyArray<T>, copies: number, make: (item: T, copy: number) => T): Array<T> =>
  Array.from({ length: copies }, (_, copy) => list.map((item) => make(item, copy))).flat()

const raw = (path: string) => fixture(`${path}.json`) as any

const radarrLists = (copies: number) => {
  const movies = copied<Json>(raw("real/radarr/movies"), copies, (movie, copy) => ({
    ...movie,
    id: id(movie.id, copy),
    title: title(movie.title, copy),
    tmdbId: externalId(movie.tmdbId, copy),
    titleSlug: `${movie.titleSlug}-${copy}`,
    sizeOnDisk: movie.sizeOnDisk + copy
  }))
  const missing = copied<Json>(raw("real/radarr/wanted-missing").records, copies, (movie, copy) => ({
    ...movie,
    id: id(movie.id, copy),
    title: title(movie.title, copy),
    tmdbId: externalId(movie.tmdbId, copy)
  }))
  const grabs = copied<Json>(raw("real/radarr/history-since"), copies, (grab, copy) => ({
    ...grab,
    id: id(grab.id, copy),
    movieId: id(grab.movieId, copy),
    sourceTitle: release(grab.sourceTitle, copy),
    downloadId: hashOf(grab.downloadId, copy)
  }))
  const calendar = copied<Json>(raw("real/radarr/calendar"), copies, (movie, copy) => ({
    ...movie,
    id: id(movie.id, copy),
    title: title(movie.title, copy),
    tmdbId: externalId(movie.tmdbId, copy)
  }))
  return { movies, missing, grabs, calendar }
}

const sonarrLists = (copies: number) => {
  const series = copied<Json>(raw("real/sonarr/series"), copies, (show, copy) => ({
    ...show,
    id: id(show.id, copy),
    title: title(show.title, copy),
    tvdbId: externalId(show.tvdbId, copy),
    tmdbId: externalId(show.tmdbId, copy),
    titleSlug: `${show.titleSlug}-${copy}`
  }))
  const episodeOf = (episode: Json, copy: number) => ({
    ...episode,
    id: id(episode.id, copy),
    seriesId: id(episode.seriesId, copy),
    ...(episode.series === undefined ? {} : { series: { ...episode.series, title: title(episode.series.title, copy) } })
  })
  const missing = copied<Json>(raw("real/sonarr/wanted-missing").records, copies, episodeOf)
  const grabs = copied<Json>(raw("real/sonarr/history-since"), copies, (grab, copy) => ({
    ...grab,
    id: id(grab.id, copy),
    episodeId: id(grab.episodeId, copy),
    seriesId: nullableId(grab.seriesId, copy),
    sourceTitle: release(grab.sourceTitle, copy),
    downloadId: hashOf(grab.downloadId, copy)
  }))
  const episodes = copied<Json>(raw("real/sonarr/episodes"), copies, episodeOf)
  const calendar = copied<Json>(raw("real/sonarr/calendar"), copies, episodeOf)
  return { series, missing, grabs, episodes, calendar }
}

/** The queues (one copy per strike copy: Cleanuparr strikes what they hold) and the strikes on them. */
const queueLists = (copies: number) => {
  const record = (entry: Json, copy: number) => ({
    ...entry,
    id: id(entry.id, copy),
    movieId: nullableId(entry.movieId, copy),
    seriesId: nullableId(entry.seriesId, copy),
    episodeId: nullableId(entry.episodeId, copy),
    title: release(entry.title, copy),
    downloadId: hashOf(entry.downloadId, copy),
    ...(entry.movie === undefined ? {} : { movie: { ...entry.movie, title: title(entry.movie.title, copy) } }),
    ...(entry.series === undefined ? {} : { series: { ...entry.series, title: title(entry.series.title, copy) } })
  })
  const strikes = copied<Json>(raw("cleanuparr/strikes").items, copies, (download, copy) => ({
    ...download,
    downloadItemId: hashOf(download.downloadItemId, copy),
    downloadId: hashOf(download.downloadId, copy),
    title: release(download.title, copy)
  }))
  return {
    radarrQueue: copied<Json>(raw("radarr/queue").records, copies, record),
    sonarrQueue: copied<Json>(raw("sonarr/queue").records, copies, record),
    strikes
  }
}

const torrentList = (copies: number) =>
  copied<Json>(raw("real/qbittorrent/torrents-info"), copies, (torrent, copy) => ({
    ...torrent,
    hash: hashOf(torrent.hash, copy),
    infohash_v1: hashOf(torrent.infohash_v1, copy),
    name: release(torrent.name, copy),
    size: torrent.size + copy
  }))

/** Each copy's candidates, tied in turn to that copy's movies or series by TMDB id. */
const candidateList = (copies: number, radarr: number, sonarr: number) => {
  const movies = raw("real/radarr/movies") as ReadonlyArray<Json>
  const series = (raw("real/sonarr/series") as ReadonlyArray<Json>).filter((show) => show.tmdbId > 0)
  return copied<Json>(raw("real/reclaimerr/candidates").items, copies, (candidate, copy) => {
    const isMovie = candidate.media_type === "movie"
    const titles = isMovie ? movies : series
    const tied = titles[candidate.id % titles.length]!
    const titleCopy = copy % (isMovie ? radarr : sonarr)
    return {
      ...candidate,
      id: id(candidate.id, copy),
      media_id: nullableId(candidate.media_id, copy),
      title: title(candidate.title, copy),
      tmdb_id: externalId(tied.tmdbId, titleCopy)
    }
  })
}

const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown): A => Schema.decodeUnknownSync(schema)(value)

/** The real home, `factor` times over (or as many copies as `Copies` says for each service). */
export const bigHome = (factor: number | Copies) => {
  const copies: Copies = typeof factor === "number"
    ? { radarr: factor, sonarr: factor, qbittorrent: factor, reclaimerr: factor, cleanuparr: factor }
    : factor
  const radarr = radarrLists(copies.radarr)
  const sonarr = sonarrLists(copies.sonarr)
  const queues = queueLists(copies.cleanuparr)
  return {
    movies: decode(RadarrMovies, radarr.movies),
    radarrMissing: decode(RadarrMissing, { records: radarr.missing }).records,
    radarrGrabs: decode(RadarrGrabs, radarr.grabs),
    radarrCalendar: decode(RadarrCalendar, radarr.calendar),
    radarrQueue: decode(QueuePage, { records: queues.radarrQueue }).records,
    series: decode(SonarrSeries, sonarr.series),
    sonarrMissing: decode(SonarrMissing, { records: sonarr.missing }).records,
    sonarrGrabs: decode(SonarrGrabs, sonarr.grabs),
    sonarrCalendar: decode(SonarrCalendar, sonarr.calendar),
    episodes: decode(SonarrEpisodes, sonarr.episodes),
    sonarrQueue: decode(QueuePage, { records: queues.sonarrQueue }).records,
    torrents: decode(finishedTorrentsRead.schema, torrentList(copies.qbittorrent)),
    candidates: decode(
      candidatesRead.schema,
      { items: candidateList(copies.reclaimerr, copies.radarr, copies.sonarr) }
    ).items,
    strikes: decode(strikesRead.schema, { items: queues.strikes }).items,
    // Settings, one of each whatever the size.
    queueCleaner: decode(settingsRead.schema, raw("real/cleanuparr/queue-cleaner")),
    stallRules: decode(stallRulesRead.schema, raw("real/cleanuparr/stall-rules")),
    slowRules: decode(slowRulesRead.schema, raw("real/cleanuparr/slow-rules")),
    downloadCleaner: decode(DownloadCleanerSettings, raw("cleanuparr/download-cleaner"))
  }
}

export type BigHome = ReturnType<typeof bigHome>

/** 2026-11-24 22:00 in Paris, when the real home was recorded. */
export const recordedAt = Date.parse("2026-11-24T21:00:00Z")
export const recordedZone = "Europe/Paris"
export const recordedDay = "2026-11-24"
