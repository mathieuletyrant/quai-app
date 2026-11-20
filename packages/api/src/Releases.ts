import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { LibraryService } from "./Library.ts"

/**
 * Where a release of the day stands: `available` (its file is there), `downloading` (in the
 * queue, downloading), `grabbed` (in the queue, not downloading yet), `missing` (nothing yet:
 * not aired, or no release found).
 */
export const DayReleaseStatus = Schema.Literals(["missing", "grabbed", "downloading", "available"]).annotate({ identifier: "DayReleaseStatus" })
export type DayReleaseStatus = typeof DayReleaseStatus.Type

/** One title out today: an episode airing (Sonarr) or a movie's digital or physical release (Radarr). */
export const DayRelease = Schema.Struct({
  /** `episode:<sonarr id>` or `movie:<radarr id>`. */
  id: Schema.String,
  kind: Schema.Literals(["episode", "movie"]),
  /** The series' or the movie's title. */
  title: Schema.String,
  /** "S02E03" */
  episode: Schema.optionalKey(Schema.String),
  episodeTitle: Schema.optionalKey(Schema.String),
  /** Epoch seconds it airs at; a movie's release has a day, no time. */
  airsAt: Schema.optionalKey(Schema.Finite),
  posterUrl: Schema.optionalKey(Schema.String),
  status: DayReleaseStatus
}).annotate({ identifier: "DayRelease" })
export type DayRelease = typeof DayRelease.Type

export const DayReleases = Schema.Struct({
  /** The home's day, "2026-11-20". */
  day: Schema.String,
  /** The time zone it's read in: the iPhones' (IANA), else Quai Cloud's `QUAI_TZ`, else UTC. */
  timeZone: Schema.String,
  /** By air time; movies (no time) last. Monitored titles only. */
  items: Schema.Array(DayRelease),
  /** Services Quai Home reaches that couldn't be read this time: their releases are missing. */
  unavailable: Schema.Array(LibraryService)
}).annotate({ identifier: "DayReleases" })
export type DayReleases = typeof DayReleases.Type

/** Today's releases, for the app's Tonight tile. Read only: Quai never grabs anything for them. */
export class ReleasesGroup extends HttpApiGroup.make("releases")
  .add(HttpApiEndpoint.get("today", "/releases/today", { success: DayReleases }).annotate(OpenApi.Identifier, "getTodayReleases"))
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api") {}
