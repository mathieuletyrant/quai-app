import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { radarrQueue } from "../src/fixes/movies.ts"
import { sonarrQueue } from "../src/fixes/series.ts"
import type { Read } from "../src/home/HomeReads.ts"
import { ManualImportRows, mediaManagementRead, ReleaseRecords } from "../src/integrations/arr.ts"
import { healthReads } from "../src/integrations/arrHealth.ts"
import { EpisodesResult, ItemsResult, Sessions, Users } from "../src/integrations/jellyfin.ts"
import {
  movieAvailabilityRead,
  RadarrCalendar,
  radarrCalendarPath,
  radarrGrabsRead,
  RadarrMissing,
  radarrMissingPath,
  radarrMoviesRead
} from "../src/integrations/radarr.ts"
import {
  detailsPath,
  pendingRead,
  requestPath,
  searchPath,
  SeerrRequest,
  SeerrSearchPage,
  SeerrSeries,
  SeerrTitle,
  SeerrUserPage,
  usersPath
} from "../src/integrations/seerr.ts"
import {
  episodesPath,
  SonarrCalendar,
  sonarrCalendarPath,
  SonarrEpisodes,
  sonarrGrabsRead,
  SonarrMissing,
  sonarrMissingPath,
  sonarrSeriesRead
} from "../src/integrations/sonarr.ts"
import { driftOf, type OpenApiSpec } from "./specDrift.ts"

const specOf = (service: string): OpenApiSpec =>
  JSON.parse(readFileSync(new URL(`fixtures/specs/${service}.json`, import.meta.url), "utf8")) as OpenApiSpec

type SpecService = "radarr" | "sonarr" | "prowlarr" | "seerr" | "jellyfin"

/** Every read of the Cloud's, by the service it reads: a new read joins its list. */
const reads: Record<SpecService, ReadonlyArray<Pick<Read<unknown>, "path" | "schema">>> = {
  radarr: [
    radarrQueue,
    radarrMoviesRead,
    movieAvailabilityRead(1),
    radarrGrabsRead(0),
    { path: radarrMissingPath, schema: RadarrMissing },
    { path: radarrCalendarPath(0, 0), schema: RadarrCalendar },
    { path: "/api/v3/release?movieId=1", schema: ReleaseRecords },
    { path: "/api/v3/manualimport?downloadId=x", schema: ManualImportRows },
    mediaManagementRead("radarr"),
    healthReads.radarr
  ],
  sonarr: [
    sonarrQueue,
    sonarrSeriesRead,
    sonarrGrabsRead(0),
    { path: sonarrMissingPath, schema: SonarrMissing },
    { path: sonarrCalendarPath(0, 0), schema: SonarrCalendar },
    { path: episodesPath(1), schema: SonarrEpisodes },
    { path: "/api/v3/release?episodeId=1", schema: ReleaseRecords },
    { path: "/api/v3/manualimport?downloadId=x", schema: ManualImportRows },
    mediaManagementRead("sonarr"),
    healthReads.sonarr
  ],
  prowlarr: [healthReads.prowlarr],
  seerr: [
    pendingRead,
    { path: requestPath(1), schema: SeerrRequest },
    { path: detailsPath("movie", 1), schema: SeerrTitle },
    { path: detailsPath("tv", 1), schema: SeerrTitle },
    { path: detailsPath("tv", 1), schema: SeerrSeries },
    { path: searchPath("paddington"), schema: SeerrSearchPage },
    { path: usersPath, schema: SeerrUserPage }
  ],
  // Watches, built in `jellyfin.ts` with their queries.
  jellyfin: [
    { path: "/Users", schema: Users },
    { path: "/Items?Recursive=true", schema: ItemsResult },
    { path: "/Items?IncludeItemTypes=Episode", schema: EpisodesResult },
    { path: "/Sessions?ActiveWithinSeconds=120", schema: Sessions }
  ]
}

/**
 * The fields Quai reads that a spec doesn't have, and why. Each is checked to be still missing, so a
 * spec that catches up drops it from here and holds it from then on.
 */
const notInSpec: Record<SpecService, ReadonlyArray<string>> = {
  // The shared *arr schemas (`integrations/arr.ts`) hold Sonarr's fields too: Sonarr's check holds them.
  radarr: [
    "GET /api/v3/queue.records[].seriesId",
    "GET /api/v3/queue.records[].episodeId",
    "GET /api/v3/queue.records[].seasonNumber",
    "GET /api/v3/queue.records[].series",
    "GET /api/v3/queue.records[].episode",
    "GET /api/v3/release[].mappedEpisodeInfo",
    "GET /api/v3/manualimport[].series",
    "GET /api/v3/manualimport[].seasonNumber",
    "GET /api/v3/manualimport[].episodes"
  ],
  // And Radarr's: Radarr's check holds them.
  sonarr: [
    "GET /api/v3/queue.records[].movieId",
    "GET /api/v3/queue.records[].movie",
    "GET /api/v3/manualimport[].movie"
  ],
  prowlarr: [],
  seerr: [
    // Seerr writes its spec by hand and leaves these out; its answers have them (`fixtures/real/seerr`).
    "GET /request.results[].type",
    "GET /request.results[].media.mediaType",
    "GET /request.results[].seasons",
    "GET /request.results[].requestedBy.displayName",
    "GET /request.results[].requestedBy.jellyfinUsername",
    "GET /request/{requestId}.type",
    "GET /request/{requestId}.media.mediaType",
    "GET /request/{requestId}.seasons",
    "GET /request/{requestId}.requestedBy.displayName",
    "GET /request/{requestId}.requestedBy.jellyfinUsername",
    "GET /tv/{tvId}.mediaInfo.seasons",
    "GET /tv/{tvId}.mediaInfo.requests[].seasons",
    "GET /user.results[].displayName",
    "GET /user.results[].jellyfinUsername",
    // `SeerrTitle` reads a movie's and a series' names alike: a movie has a title, a series a name.
    "GET /movie/{movieId}.name",
    "GET /movie/{movieId}.firstAirDate",
    "GET /tv/{tvId}.title",
    "GET /tv/{tvId}.releaseDate"
  ],
  jellyfin: []
}

const fieldOf = (drift: string) => drift.split(":")[0] ?? drift

describe("the services' specs", () => {
  for (const service of Object.keys(reads) as ReadonlyArray<SpecService>) {
    const spec = specOf(service)
    const drifts = reads[service].flatMap((read) => driftOf(spec, read))

    it(`${service}: every field Quai reads is in the spec, with its type`, () => {
      expect(drifts.filter((drift) => !notInSpec[service].includes(fieldOf(drift)))).toEqual([])
    })

    it.skipIf(notInSpec[service].length === 0)(
      `${service}: each field known to be missing from the spec still is`,
      () => {
        expect(notInSpec[service].filter((field) => !drifts.map(fieldOf).includes(field))).toEqual([])
      }
    )
  }
})
