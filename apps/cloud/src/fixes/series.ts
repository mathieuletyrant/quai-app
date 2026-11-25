import { type EpisodeChoice, FixFailed, InvalidFix } from "@quai/api"
import { Effect, Option, Result } from "effect"
import type { Read } from "../home/HomeReads.ts"
import {
  echoed,
  epochSeconds,
  fileOf,
  grabLookbackMs,
  isImportBlocked,
  knownYear,
  posterOf,
  queueMessages,
  QueuePage,
  type QueueRecord
} from "../integrations/arr.ts"
import { readJson } from "../integrations/Integration.ts"
import {
  episodeCode,
  episodeLabel,
  episodesPath,
  type MissingEpisode,
  SonarrEpisodes,
  SonarrGrabs,
  sonarrGrabsRead,
  SonarrMissing,
  sonarrMissingPath,
  sonarrQueuePath
} from "../integrations/sonarr.ts"
import { type Detected, noSourceAfterMs } from "./Detected.ts"
import * as FixId from "./FixId.ts"
import {
  type ImportCommandFile,
  importFileOf,
  type ImportInput,
  type MediaFixes,
  type QueuedMedia
} from "./MediaFixes.ts"

/** What a series' problem acts on: its blocked download, or a season's episodes without a source. */
export type SeriesTarget =
  | {
    readonly kind: "series"
    readonly _tag: "Queue"
    readonly queueId: number
    readonly downloadId: string | undefined
    readonly seriesId: number | undefined
    readonly seasonNumber: number | undefined
  }
  | {
    readonly kind: "series"
    readonly _tag: "Missing"
    readonly seriesId: number
    readonly seasonNumber: number
    readonly episodeIds: ReadonlyArray<number>
  }

/** A download in Sonarr's queue (one row per episode): its series and episodes, or the release when Sonarr doesn't know them. */
export const queuedEpisodes = (records: ReadonlyArray<QueueRecord>): QueuedMedia => {
  const record = records[0]
  const series = record?.series
  const episodes = records.flatMap((entry) => entry.episode === undefined ? [] : [entry.episode])
  return {
    title: series === undefined ? record?.title ?? "Unknown download" : episodeLabel(series.title, episodes),
    year: knownYear(series?.year),
    posterUrl: posterOf(series?.images),
    messages: [...new Set(records.flatMap(queueMessages))]
  }
}

/** Sonarr's queue, with the series and episodes. */
export const sonarrQueue: Read<typeof QueuePage.Type> = { service: "sonarr", path: sonarrQueuePath, schema: QueuePage }

/** A finished download Sonarr won't import. Import anyway needs the series: then the episode can be chosen. */
export const blockedEpisodes = (record: QueueRecord): Detected<SeriesTarget> => {
  const { title, year, posterUrl, messages } = queuedEpisodes([record])
  const series = record.series
  const since = epochSeconds(record.added)
  const seriesId = record.seriesId ?? undefined
  return {
    fix: {
      id: FixId.blocked("sonarr", record.id),
      kind: "importBlocked",
      service: "sonarr",
      title,
      ...(year === undefined ? {} : { year }),
      ...(posterUrl === undefined ? {} : { posterUrl }),
      reason: messages[0] ?? "Waiting for a manual import",
      ...(since === undefined ? {} : { since }),
      actions: seriesId !== undefined && series !== undefined ? ["importAnyway", "remove"] : ["remove"],
      download: {
        release: record.title ?? "",
        messages,
        ...(record.downloadClient ? { downloadClient: record.downloadClient } : {})
      }
    },
    target: {
      kind: "series",
      _tag: "Queue",
      queueId: record.id,
      downloadId: record.downloadId ?? undefined,
      seriesId,
      seasonNumber: record.seasonNumber ?? record.episode?.seasonNumber ?? undefined
    }
  }
}

/**
 * Aired, monitored episodes still without a file, with nothing in the queue and no grab since they
 * aired (or since the series was added, when later), for over 2 hours. Grouped by season: one
 * problem per series and season, searched for together.
 */
export const episodesWithoutSource = (
  missing: ReadonlyArray<MissingEpisode>,
  queue: ReadonlyArray<QueueRecord>,
  grabs: typeof SonarrGrabs.Type,
  nowMs: number
): ReadonlyArray<Detected<SeriesTarget>> => {
  const queued = new Set(
    queue.flatMap((record) => record.episodeId === undefined || record.episodeId === null ? [] : [record.episodeId])
  )
  const seasons = new Map<string, { since: number; aired: boolean; episodes: Array<MissingEpisode> }>()
  for (const episode of missing) {
    if (
      episode.hasFile === true || episode.monitored === false || episode.series === undefined || queued.has(episode.id)
    ) continue
    const aired = epochSeconds(episode.airDateUtc)
    const added = epochSeconds(episode.series.added)
    if (aired === undefined) continue
    const since = added === undefined ? aired : Math.max(added, aired)
    if (nowMs - since * 1000 < noSourceAfterMs) continue
    const grabbed = grabs.some((grab) =>
      grab.episodeId === episode.id && (grab.eventType ?? "grabbed") === "grabbed" &&
      (epochSeconds(grab.date) ?? 0) >= since
    )
    if (grabbed) continue
    const key = `${episode.seriesId}-${episode.seasonNumber}`
    const season = seasons.get(key) ?? { since, aired: since === aired, episodes: [] }
    season.episodes.push(episode)
    if (since < season.since) seasons.set(key, { ...season, since, aired: since === aired })
    else seasons.set(key, season)
  }
  return [...seasons.values()].map(({ since, aired, episodes }): Detected<SeriesTarget> => {
    const sorted = [...episodes].sort((left, right) => left.episodeNumber - right.episodeNumber)
    const first = sorted[0]!
    const series = first.series!
    const year = knownYear(series.year)
    const posterUrl = posterOf(series.images)
    return {
      fix: {
        id: FixId.missingSeason(first.seriesId, first.seasonNumber),
        kind: "noSource",
        service: "sonarr",
        title: episodeLabel(series.title, sorted),
        ...(year === undefined ? {} : { year }),
        ...(posterUrl === undefined ? {} : { posterUrl }),
        reason: aired ? "No release grabbed since it aired" : "No release grabbed since the series was added",
        since,
        actions: ["searchReleases", "ignoreAndWait"],
        missing: { episodes: sorted.map((episode) => episodeCode(episode.seasonNumber, episode.episodeNumber)) }
      },
      target: {
        kind: "series",
        _tag: "Missing",
        seriesId: first.seriesId,
        seasonNumber: first.seasonNumber,
        episodeIds: sorted.map((episode) => episode.id)
      }
    }
  })
}

/**
 * Each file is the episodes chosen for it, among those without a file and in one season; else the
 * episodes Sonarr matched, none of which has a file yet.
 */
export const episodeImportFiles = (
  { assignments, choices, downloadId, rows, target }: ImportInput<SeriesTarget>
): Result.Result<ReadonlyArray<ImportCommandFile>, InvalidFix> => {
  const seriesId = target.seriesId
  if (seriesId === undefined) {
    return Result.fail(new InvalidFix({ message: "Sonarr doesn't know which series this is" }))
  }
  const chosen = new Map(assignments.map((assignment) => [assignment.file, assignment.episodeIds]))
  const freeById = new Map(choices.map((episode) => [episode.id, episode]))
  const files: Array<ImportCommandFile> = []
  for (const row of rows) {
    const file = fileOf(row)
    const picked = chosen.get(file)
    if (picked !== undefined) {
      const episodes = picked.map((episodeId) => freeById.get(episodeId))
      if (episodes.some((episode) => episode === undefined)) {
        return Result.fail(
          new InvalidFix({ message: `Choose episodes of this series that have no file yet for ${file}` })
        )
      }
      const seasons = new Set(episodes.map((episode) => episode!.seasonNumber))
      if (seasons.size !== 1) {
        return Result.fail(new InvalidFix({ message: `The episodes chosen for ${file} must be in one season` }))
      }
      files.push({
        path: row.path!,
        seriesId,
        seasonNumber: [...seasons][0]!,
        episodeIds: [...picked],
        downloadId,
        ...echoed(row)
      })
      continue
    }
    const matched = row.episodes ?? []
    if (matched.length === 0) return Result.fail(new InvalidFix({ message: `Choose the episode for ${file}` }))
    if (matched.some((episode) => episode.hasFile === true)) {
      return Result.fail(new InvalidFix({ message: `${file} matches an episode that already has a file` }))
    }
    files.push({
      path: row.path!,
      seriesId: row.series?.id ?? seriesId,
      seasonNumber: matched[0]!.seasonNumber,
      episodeIds: matched.map((episode) => episode.id),
      downloadId,
      ...echoed(row)
    })
  }
  return Result.succeed(files)
}

/** The To fix list's series: Sonarr's. */
export const series: MediaFixes<SeriesTarget> = {
  kind: "series",
  service: "sonarr",
  queue: sonarrQueue,
  queued: queuedEpisodes,
  detect: (reads, nowMs) =>
    Effect.map(
      reads.all({
        queue: sonarrQueue,
        missing: { service: "sonarr", path: sonarrMissingPath, schema: SonarrMissing },
        grabs: sonarrGrabsRead(nowMs - grabLookbackMs)
      }),
      ({ values }) =>
        // The rules need all three reads.
        Option.map(Option.all([values.queue, values.missing, values.grabs]), ([queue, missing, grabs]) => [
          ...queue.records.filter(isImportBlocked).map(blockedEpisodes),
          ...episodesWithoutSource(missing.records, queue.records, grabs, nowMs)
        ])
    ),
  importHints: (target) =>
    target.seriesId === undefined
      ? ""
      : `&seriesId=${target.seriesId}${
        target.seasonNumber === undefined ? "" : `&seasonNumber=${target.seasonNumber}`
      }`,
  importFile: (row) => {
    const episodes = row.episodes ?? []
    return importFileOf(
      row,
      episodes.map((episode) => episodeCode(episode.seasonNumber, episode.episodeNumber)),
      episodes.length === 0
    )
  },
  // The series' episodes without a file: the only ones a file may be imported as.
  choices: (reads, target) =>
    target.seriesId === undefined
      ? Effect.succeed([])
      : Effect.map(
        reads.write({ service: "sonarr", method: "GET", path: episodesPath(target.seriesId) }, (message) =>
          new FixFailed({ message })),
        (body): ReadonlyArray<EpisodeChoice> =>
          Option.getOrElse(readJson(SonarrEpisodes, body), () => [])
            .filter((episode) =>
              episode.hasFile !== true && episode.seasonNumber > 0
            )
            .sort((left, right) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber)
            .map((episode) => ({
              id: episode.id,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              ...(episode.title === undefined ? {} : { title: episode.title })
            }))
      ),
  importFiles: episodeImportFiles,
  releaseSearch: (target) =>
    target.episodeIds.length === 1
      ? `/api/v3/release?episodeId=${target.episodeIds[0]}`
      : `/api/v3/release?seriesId=${target.seriesId}&seasonNumber=${target.seasonNumber}`,
  // A season search also finds packs of episodes that have their file: only the releases that
  // cover nothing but missing episodes are offered, so grabbing never replaces a file.
  usable: (target, release) => {
    const ids = (release.mappedEpisodeInfo ?? []).map((info) => info.id)
    return ids.length > 0 && ids.every((episodeId) => episodeId !== undefined && target.episodeIds.includes(episodeId))
  }
}
