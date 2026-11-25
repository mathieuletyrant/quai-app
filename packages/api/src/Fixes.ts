import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { Service } from "./Service.ts"

/**
 * The To fix list: problems found by fixed rules (no AI) in what Quai Home reads, each with its own
 * one-tap fix. Computed when asked, never stored; what the user chose to hide (ignored for now, let
 * go) is kept at home.
 *
 * - `importBlocked`: a finished download Radarr or Sonarr won't import.
 * - `plannedDeletion`: a title Reclaimerr is going to delete.
 * - `stuckRemoval`: a download Cleanuparr removes from the queue at its next strike.
 * - `noSource`: a monitored title still without a file, and no release grabbed for it, 2 hours
 *   after it was added or became available (aired, for an episode).
 */
export const FixKind = Schema.Literals(["importBlocked", "plannedDeletion", "stuckRemoval", "noSource"]).annotate({
  identifier: "FixKind"
})
export type FixKind = typeof FixKind.Type

export const FixService = Service.pick(["radarr", "sonarr", "reclaimerr", "cleanuparr"]).annotate({
  identifier: "FixService"
})
export type FixService = typeof FixService.Type

/**
 * What a problem offers:
 * - `remove`: take the download out of the queue and the download client (optionally blocklist it);
 * - `importAnyway`: import its files as Radarr or Sonarr matched them (or to the episodes chosen);
 * - `keep`: protect the title in Reclaimerr, for good; or exclude the download from Cleanuparr's
 *   queue cleaner, for good;
 * - `letGo`: let the deletion or the removal happen, and stop showing it;
 * - `searchReleases`: list the releases the indexers have, to grab one;
 * - `ignoreAndWait`: hide it until a release is grabbed, or for some days.
 */
export const FixAction = Schema.Literals(["remove", "importAnyway", "keep", "letGo", "searchReleases", "ignoreAndWait"])
  .annotate({
    identifier: "FixAction"
  })
export type FixAction = typeof FixAction.Type

/** `importBlocked`: the download in the queue, and what Radarr or Sonarr says about it. */
export const BlockedDownload = Schema.Struct({
  /** The release, as the download client names it. */
  release: Schema.String,
  /** Every message the *arr gave, in order (the first one is the fix's `reason`). */
  messages: Schema.Array(Schema.String),
  downloadClient: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "BlockedDownload" })

/** `plannedDeletion`: when Reclaimerr deletes (or moves) the title. */
export const PlannedDeletion = Schema.Struct({
  /** Epoch seconds. In the past: it goes at Reclaimerr's next cleanup run. */
  deletesAt: Schema.Finite,
  operation: Schema.Literals(["delete", "move"])
}).annotate({ identifier: "PlannedDeletion" })
export type PlannedDeletion = typeof PlannedDeletion.Type

/**
 * Why Cleanuparr strikes a download: stalled, downloading too slowly (or too long), an import that
 * keeps failing, stuck on its metadata, or in error in the download client.
 */
export const RemovalReason = Schema.Literals(["stalled", "slow", "failedImport", "downloadingMetadata", "errored"])
  .annotate({
    identifier: "RemovalReason"
  })
export type RemovalReason = typeof RemovalReason.Type

/** `stuckRemoval`: the download, its strikes, and when Cleanuparr strikes again. */
export const StuckRemoval = Schema.Struct({
  /** The release, as the download client names it. */
  release: Schema.String,
  reason: RemovalReason,
  /** "2 of 3": the strikes it has for this reason, and the number that removes it. */
  strikes: Schema.Int,
  maxStrikes: Schema.Int,
  /** Epoch seconds of Cleanuparr's next queue cleaning, when it's scheduled: the strike that removes it. */
  removesAt: Schema.optionalKey(Schema.Finite)
}).annotate({ identifier: "StuckRemoval" })
export type StuckRemoval = typeof StuckRemoval.Type

/** `noSource`: what has no file. A series' missing episodes are grouped by season. */
export const MissingMedia = Schema.Struct({
  /** "S02E03", one per missing episode; empty for a movie. */
  episodes: Schema.Array(Schema.String)
}).annotate({ identifier: "MissingMedia" })

export const Fix = Schema.Struct({
  /**
   * Stable while the problem lasts: `blocked-radarr-<queue id>`, `deletion-<candidate id>`,
   * `removal-<Cleanuparr download item id>`, `missing-movie-<id>`, `missing-season-<series>-<season>`.
   */
  id: Schema.String,
  kind: FixKind,
  service: FixService,
  /** The title it is about: "Dune: Part Two", "Severance · S02E03". */
  title: Schema.String,
  year: Schema.optionalKey(Schema.Int),
  /** The poster's public URL, when the service lists one. */
  posterUrl: Schema.optionalKey(Schema.String),
  /** Why, in the service's words when it gives them: "Not an upgrade for existing movie file". */
  reason: Schema.String,
  /** Epoch seconds the problem started, when known: the download was added, the title became available. */
  since: Schema.optionalKey(Schema.Finite),
  /** The actions offered, the main one first. */
  actions: Schema.Array(FixAction),
  download: Schema.optionalKey(BlockedDownload),
  deletion: Schema.optionalKey(PlannedDeletion),
  removal: Schema.optionalKey(StuckRemoval),
  missing: Schema.optionalKey(MissingMedia)
}).annotate({ identifier: "Fix" })
export type Fix = typeof Fix.Type

export const Fixes = Schema.Struct({
  items: Schema.Array(Fix),
  /** How many fixes are hidden for now (ignored for now, or let go). */
  hidden: Schema.Int,
  /** Services Quai Home reaches that couldn't be read this time: their problems are missing. */
  unavailable: Schema.Array(FixService)
}).annotate({ identifier: "Fixes" })
export type Fixes = typeof Fixes.Type

/** One release an indexer offers for a title without a file. */
export const Release = Schema.Struct({
  guid: Schema.String,
  indexerId: Schema.Int,
  indexer: Schema.String,
  title: Schema.String,
  sizeBytes: Schema.Finite,
  protocol: Schema.String,
  seeders: Schema.optionalKey(Schema.Int),
  leechers: Schema.optionalKey(Schema.Int),
  /** "Bluray-1080p" */
  quality: Schema.String,
  languages: Schema.Array(Schema.String),
  ageHours: Schema.Finite,
  customFormatScore: Schema.optionalKey(Schema.Int),
  /** Radarr or Sonarr wouldn't grab it on its own: `rejections` says why. It can still be grabbed. */
  rejected: Schema.Boolean,
  rejections: Schema.Array(Schema.String)
}).annotate({ identifier: "Release" })
export type Release = typeof Release.Type

export const Releases = Schema.Struct({
  /** Accepted ones first, then by seeders. */
  items: Schema.Array(Release)
}).annotate({ identifier: "Releases" })
export type Releases = typeof Releases.Type

export const GrabRelease = Schema.Struct({
  guid: Schema.String,
  indexerId: Schema.Int
}).annotate({ identifier: "GrabRelease" })
export type GrabRelease = typeof GrabRelease.Type

export const RemoveDownload = Schema.Struct({
  /** Also blocklist the release, so it's never grabbed again. */
  blocklist: Schema.Boolean
}).annotate({ identifier: "RemoveDownload" })
export type RemoveDownload = typeof RemoveDownload.Type

export const IgnoreAndWait = Schema.Struct({
  /** Hide it this many days. Left out: until a release is grabbed for it. */
  days: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 })))
}).annotate({ identifier: "IgnoreAndWait" })
export type IgnoreAndWait = typeof IgnoreAndWait.Type

/** One file of a blocked download, as Radarr or Sonarr's manual import sees it. */
export const ImportFile = Schema.Struct({
  /** The file's path inside the download: names it in `ImportDownload`. */
  file: Schema.String,
  sizeBytes: Schema.optionalKey(Schema.Finite),
  quality: Schema.optionalKey(Schema.String),
  /** The episodes Sonarr matched ("S01E04"); empty when it couldn't, or for a movie. */
  episodes: Schema.Array(Schema.String),
  /** Sonarr couldn't tell which episode it is: one must be chosen. */
  needsEpisodes: Schema.Boolean,
  /** Why it wasn't imported on its own; importing anyway goes past these. */
  rejections: Schema.Array(Schema.String)
}).annotate({ identifier: "ImportFile" })
export type ImportFile = typeof ImportFile.Type

/** An episode a file can be imported as: one of the series' episodes that has no file. */
export const EpisodeChoice = Schema.Struct({
  id: Schema.Int,
  seasonNumber: Schema.Int,
  episodeNumber: Schema.Int,
  title: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "EpisodeChoice" })
export type EpisodeChoice = typeof EpisodeChoice.Type

/** What "Import anyway" would import, read when it's asked. */
export const ImportPreview = Schema.Struct({
  files: Schema.Array(ImportFile),
  /** For a Sonarr file that needs its episodes chosen; empty otherwise. */
  episodes: Schema.Array(EpisodeChoice)
}).annotate({ identifier: "ImportPreview" })
export type ImportPreview = typeof ImportPreview.Type

export const EpisodeAssignment = Schema.Struct({
  file: Schema.String,
  episodeIds: Schema.Array(Schema.Int).check(Schema.isMinLength(1))
}).annotate({ identifier: "EpisodeAssignment" })

export const ImportDownload = Schema.Struct({
  /** The episodes chosen for files Sonarr couldn't match. Files left out import as matched. */
  assignments: Schema.Array(EpisodeAssignment)
}).annotate({ identifier: "ImportDownload" })
export type ImportDownload = typeof ImportDownload.Type

/** The action isn't one this problem offers, or what it needs is missing (an episode to choose). */
export class InvalidFix extends Schema.TaggedError<InvalidFix>()("InvalidFix", {
  message: Schema.String
}, { httpApiStatus: 400 }) {}

/** The service refused or failed the fix: its answer, in its words. */
export class FixFailed extends Schema.TaggedError<FixFailed>()("FixFailed", {
  message: Schema.String
}, { httpApiStatus: 502 }) {}

const id = { id: Schema.String }

/** The To fix list, for the app. */
export class FixesGroup extends HttpApiGroup.make("fixes")
  .add(
    HttpApiEndpoint.get("list", "/fixes", { success: Fixes }).annotate(OpenApi.Identifier, "listFixes"),
    HttpApiEndpoint.post("remove", "/fixes/:id/remove", {
      params: id,
      payload: RemoveDownload,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    }).annotate(OpenApi.Identifier, "removeDownload"),
    HttpApiEndpoint.get("importPreview", "/fixes/:id/import", {
      params: id,
      success: ImportPreview,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    }).annotate(OpenApi.Identifier, "previewImport"),
    HttpApiEndpoint.post("import", "/fixes/:id/import", {
      params: id,
      payload: ImportDownload,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    }).annotate(OpenApi.Identifier, "importDownload"),
    HttpApiEndpoint.post("keep", "/fixes/:id/keep", {
      params: id,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "keepTitle"),
    HttpApiEndpoint.post("letGo", "/fixes/:id/let-go", {
      params: id,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "letGoFix"),
    HttpApiEndpoint.post("ignoreAndWait", "/fixes/:id/ignore-and-wait", {
      params: id,
      payload: IgnoreAndWait,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "ignoreAndWaitFix"),
    HttpApiEndpoint.get("releases", "/fixes/:id/releases", {
      params: id,
      success: Releases,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    }).annotate(OpenApi.Identifier, "searchReleases"),
    HttpApiEndpoint.post("grab", "/fixes/:id/grab", {
      params: id,
      payload: GrabRelease,
      error: [InvalidFix, FixFailed, HttpApiError.NotFound]
    }).annotate(OpenApi.Identifier, "grabRelease")
  )
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api")
{}
