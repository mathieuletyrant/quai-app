import { type EpisodeChoice, type FixFailed, type HomeOffline, type ImportFile, InvalidFix } from "@quai/api"
import { type Effect, type Option, Result } from "effect"
import type { HomeReads, Read } from "../home/HomeReads.ts"
import { fileOf, type ManualImportRow, qualityName, type QueuePage, type QueueRecord, type ReleaseRecord, rejectionsOf } from "../integrations/arr.ts"
import type { Detected } from "./Detected.ts"

/**
 * What a To fix problem on a movie or a series acts on: a finished download the *arr won't import
 * (its queue row), or titles without a source (to search releases for).
 */
export type MediaTarget =
  | { readonly kind: "movie" | "series"; readonly _tag: "Queue"; readonly queueId: number; readonly downloadId: string | undefined }
  | { readonly kind: "movie" | "series"; readonly _tag: "Missing" }

export type QueuedOf<T extends MediaTarget> = Extract<T, { readonly _tag: "Queue" }>
export type MissingOf<T extends MediaTarget> = Extract<T, { readonly _tag: "Missing" }>

export const isQueued = <T extends MediaTarget>(target: T): target is QueuedOf<T> => target._tag === "Queue"
export const isMissing = <T extends MediaTarget>(target: T): target is MissingOf<T> => target._tag === "Missing"

/** The file and the episodes the user chose for it (none for a movie, or a file the *arr matched). */
export type ImportAssignments = ReadonlyArray<{ readonly file: string; readonly episodeIds: ReadonlyArray<number> }>

/** One file of a `ManualImport` command, as the *arr takes it. */
export type ImportCommandFile = Readonly<Record<string, unknown>> & { readonly path: string; readonly downloadId: string }

/** A download in an *arr's queue, as the To fix list names it. */
export interface QueuedMedia {
  /** "Dune: Part Two", "Severance · S02E03"; the release when the *arr doesn't know the title. */
  readonly title: string
  readonly year?: number | undefined
  readonly posterUrl?: string | undefined
  /** What the *arr says about it, flattened (`queueMessages`). */
  readonly messages: ReadonlyArray<string>
}

/** What deciding the files of a blocked download takes: all read beforehand, nothing to call. */
export interface ImportInput<T extends MediaTarget> {
  readonly target: QueuedOf<T>
  readonly downloadId: string
  /** The download's files as the manual import matched them, each with a path. */
  readonly rows: ReadonlyArray<ManualImportRow>
  readonly assignments: ImportAssignments
  /** What a file may be imported as when the *arr didn't match it (`choices`, read only with assignments). */
  readonly choices: ReadonlyArray<EpisodeChoice>
}

/**
 * The To fix list's rules and fixes for one kind of media: movies (Radarr) or series (Sonarr).
 * Fixes.ts runs what they share (finding a problem again, what the user hid, the writes) and asks
 * the adapter only what differs between them, so no code branches on the service.
 */
export interface MediaFixes<T extends MediaTarget> {
  readonly kind: T["kind"]
  readonly service: "radarr" | "sonarr"
  /** Its queue, as its rules read it: also where another service's download (Cleanuparr's) is found by id. */
  readonly queue: Read<typeof QueuePage.Type>
  /** One download in its queue, from its rows (Sonarr has one per episode of a pack). */
  readonly queued: (records: ReadonlyArray<QueueRecord>) => QueuedMedia
  /** Its rules, on what Quai Home reads now. None when one of the reads didn't answer. */
  readonly detect: (reads: HomeReads["Service"], nowMs: number) => Effect.Effect<Option.Option<ReadonlyArray<Detected<T>>>, HomeOffline>
  /** The manual import's hints beyond the download (`&seriesId=9`), to match its files better. */
  readonly importHints: (target: QueuedOf<T>) => string
  /** A matched file as the app shows it. */
  readonly importFile: (row: ManualImportRow) => ImportFile
  /** What an unmatched file may be imported as: the episodes without a file (none for a movie). */
  readonly choices: (reads: HomeReads["Service"], target: QueuedOf<T>) => Effect.Effect<ReadonlyArray<EpisodeChoice>, HomeOffline | FixFailed>
  /**
   * The `ManualImport` files, or why they can't be imported. Never over a file already there.
   * Called through `importFiles`, which checks what all kinds share first.
   */
  readonly importFiles: (input: ImportInput<T>) => Result.Result<ReadonlyArray<ImportCommandFile>, InvalidFix>
  /** The interactive search for the missing titles: path and query. */
  readonly releaseSearch: (target: MissingOf<T>) => string
  /** A release grabbing it would never replace a file. */
  readonly usable: (target: MissingOf<T>, release: ReleaseRecord) => boolean
}

/** A manual import row as the app shows it; `episodes` are the codes of those it matched. */
export const importFileOf = (row: ManualImportRow, episodes: ReadonlyArray<string>, needsEpisodes: boolean): ImportFile => {
  const quality = qualityName(row.quality)
  return {
    file: fileOf(row),
    ...(row.size === undefined ? {} : { sizeBytes: row.size }),
    ...(quality === undefined ? {} : { quality }),
    episodes: [...episodes],
    needsEpisodes,
    rejections: rejectionsOf(row)
  }
}

/**
 * The `ManualImport` files of a blocked download, or why it can't be imported: a file left to
 * import, each assignment one of the download's files, then the adapter's rules. Pure: everything
 * is read beforehand.
 */
export const importFiles = <T extends MediaTarget>(
  adapter: MediaFixes<T>,
  input: ImportInput<T>
): Result.Result<ReadonlyArray<ImportCommandFile>, InvalidFix> => {
  if (input.rows.length === 0) return Result.fail(new InvalidFix({ message: "There's no file left to import" }))
  const known = new Set(input.rows.map(fileOf))
  const unknown = input.assignments.find((a) => !known.has(a.file))
  if (unknown !== undefined) return Result.fail(new InvalidFix({ message: `${unknown.file} isn't in this download` }))
  return adapter.importFiles(input)
}
