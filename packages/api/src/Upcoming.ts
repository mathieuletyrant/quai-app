import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"

/**
 * What a row of Upcoming is (docs/upcoming.md):
 * - `release`: a monitored movie or episode without its file, out on that day (coming);
 * - `deletion`: a title Reclaimerr deletes on its own (going);
 * - `stuckRemoval`: a download Cleanuparr's queue cleaner takes out at its next strike, if it's still stuck (going);
 * - `seedCleanup`: finished torrents Cleanuparr's download cleaner takes out of qBittorrent, grouped by week (going).
 */
export const UpcomingKind = Schema.Literals(["release", "deletion", "stuckRemoval", "seedCleanup"]).annotate({ identifier: "UpcomingKind" })
export type UpcomingKind = typeof UpcomingKind.Type

/** Who does it: the row's tag. */
export const UpcomingService = Schema.Literals(["radarr", "sonarr", "reclaimerr", "cleanuparr", "qbittorrent"]).annotate({
  identifier: "UpcomingService"
})
export type UpcomingService = typeof UpcomingService.Type

export const UpcomingItem = Schema.Struct({
  /** Stable while it's planned: `release-episode-<id>`, `deletion-<candidate id>`, `removal-<id>`, `seed-<week day>-<rule>`. */
  id: Schema.String,
  kind: UpcomingKind,
  service: UpcomingService,
  /** The movie's or the series' title; for a seed cleanup, "14 torrents". */
  title: Schema.String,
  /** "S02E05", "S01E07–E08" */
  episode: Schema.optionalKey(Schema.String),
  posterUrl: Schema.optionalKey(Schema.String),
  /**
   * Epoch seconds it happens at. A movie's release is a day (its midnight, `timed` false). None for
   * a seed cleanup by ratio: no date can be known.
   */
  at: Schema.optionalKey(Schema.Finite),
  /** Whether `at` has a meaningful time of day (an episode's air time, a run of Reclaimerr or Cleanuparr). */
  timed: Schema.Boolean,
  /** A range's last instant, epoch seconds: a week of seed cleanups. */
  until: Schema.optionalKey(Schema.Finite),
  /** `at` is the earliest it can happen: a stuck removal happens only if the download is still stuck then. */
  earliest: Schema.Boolean,
  /** How many torrents a seed cleanup takes. */
  count: Schema.optionalKey(Schema.Int),
  /**
   * The space that comes back on the disk at that moment, when it's known: the last copy of the
   * files goes (the library's and every torrent seeding them). None when nothing, or not sure.
   */
  freesBytes: Schema.optionalKey(Schema.Finite),
  /** The To fix card it opens (a deletion, a stuck removal). */
  fixId: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "UpcomingItem" })
export type UpcomingItem = typeof UpcomingItem.Type

export const Upcoming = Schema.Struct({
  /** The time zone the days are read in: the iPhones' (IANA), else Quai Cloud's `QUAI_TZ`, else UTC. */
  timeZone: Schema.String,
  /** Releases cover the next 14 days, what goes every date known; by `at`, undated last. */
  items: Schema.Array(UpcomingItem),
  /** Services Quai Home reaches that couldn't be read this time: what they plan is missing. */
  unavailable: Schema.Array(UpcomingService),
  /** Quai Home is too old to read seed cleanups and the space that comes back: update it to see them. */
  homeOutdated: Schema.Boolean
}).annotate({ identifier: "Upcoming" })
export type Upcoming = typeof Upcoming.Type

/** How many days of releases Upcoming shows. */
export const upcomingReleaseDays = 14

/** What the stack will do on its own, by date. Read only. */
export class UpcomingGroup extends HttpApiGroup.make("upcoming")
  .add(HttpApiEndpoint.get("list", "/upcoming", { success: Upcoming }).annotate(OpenApi.Identifier, "getUpcoming"))
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api") {}
