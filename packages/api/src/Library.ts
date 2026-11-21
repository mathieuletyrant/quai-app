import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"

export const LibraryKind = Schema.Literals(["movie", "series"]).annotate({ identifier: "LibraryKind" })
export type LibraryKind = typeof LibraryKind.Type

/**
 * Where a title stands:
 * - `available`: on disk (a series: some episodes have their file, and none Sonarr still looks for);
 * - `downloading`: a running activity follows its torrent;
 * - `wanted`: Radarr or Sonarr looks for it: monitored, without its file (a series: monitored,
 *   with aired episodes still without a file, or nothing on disk yet);
 * - `notMonitored`: without a file, and Radarr or Sonarr isn't looking for it (often watched,
 *   then deleted).
 */
export const LibraryStatus = Schema.Literals(["available", "downloading", "wanted", "notMonitored"]).annotate({ identifier: "LibraryStatus" })
export type LibraryStatus = typeof LibraryStatus.Type

/** A series' episodes: those with a file, out of Sonarr's count of the ones it expects or holds. */
export const EpisodeCount = Schema.Struct({
  /** On disk. */
  have: Schema.Int,
  /** Sonarr's `episodeCount`: the monitored episodes that aired, plus every episode with a file. */
  total: Schema.Int
}).annotate({ identifier: "EpisodeCount" })

/** One title of the library, as the app's Library grid shows it. */
export const LibraryItem = Schema.Struct({
  /** `movie:<radarr id>` or `series:<sonarr id>`: unique in the list. */
  id: Schema.String,
  kind: LibraryKind,
  title: Schema.String,
  year: Schema.optionalKey(Schema.Int),
  /** The poster's public URL (TMDB, TheTVDB), as Radarr or Sonarr list it. Never a URL that needs a key. */
  posterUrl: Schema.optionalKey(Schema.String),
  status: LibraryStatus,
  /** While downloading, when known: 0 to 1. */
  progress: Schema.optionalKey(Schema.Finite),
  /** Epoch seconds the title was added to Radarr or Sonarr. */
  addedAt: Schema.optionalKey(Schema.Finite),
  sizeBytes: Schema.Finite,
  overview: Schema.optionalKey(Schema.String),
  episodes: Schema.optionalKey(EpisodeCount),
  /**
   * The title's page in Radarr or Sonarr, at each address Quai Home gave: at home first, then from
   * outside. Absent when it gave none.
   */
  webUrls: Schema.optionalKey(Schema.Array(Schema.String))
}).annotate({ identifier: "LibraryItem" })
export type LibraryItem = typeof LibraryItem.Type

/** The disk the media lives on, as Radarr (or Sonarr) sees it. */
export const DiskSpace = Schema.Struct({
  freeBytes: Schema.Finite,
  totalBytes: Schema.Finite
}).annotate({ identifier: "DiskSpace" })
export type DiskSpace = typeof DiskSpace.Type

export const LibraryService = Schema.Literals(["radarr", "sonarr"]).annotate({ identifier: "LibraryService" })

export const Library = Schema.Struct({
  /** Newest first. */
  items: Schema.Array(LibraryItem),
  disk: Schema.optionalKey(DiskSpace),
  /** Services Quai Home reaches that couldn't be read this time: their titles are missing. */
  unavailable: Schema.Array(LibraryService)
}).annotate({ identifier: "Library" })
export type Library = typeof Library.Type

/** The home's movies and series, for the app's Library tab. */
export class LibraryGroup extends HttpApiGroup.make("library")
  .add(
    HttpApiEndpoint.get("library", "/library", { success: Library })
      .annotate(OpenApi.Identifier, "getLibrary")
      .middleware(DeviceAuth)
  )
  .middleware(HomeRequired)
  .prefix("/api") {}
