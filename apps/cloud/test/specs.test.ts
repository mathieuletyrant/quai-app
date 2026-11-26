import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { radarrQueue } from "../src/fixes/movies.ts"
import { sonarrQueue } from "../src/fixes/series.ts"
import type { Read } from "../src/home/HomeReads.ts"
import { ManualImportRows, mediaManagementRead, ReleaseRecords } from "../src/integrations/arr.ts"
import { healthReads } from "../src/integrations/arrHealth.ts"
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

const reads: Record<"radarr" | "sonarr", ReadonlyArray<Pick<Read<unknown>, "path" | "schema">>> = {
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
  ]
}

/**
 * The fields of the shared *arr schemas (`integrations/arr.ts`) that only the other service answers:
 * the other service's own check still holds them to its spec.
 */
const theOthers: Record<"radarr" | "sonarr", ReadonlyArray<string>> = {
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
  sonarr: [
    "GET /api/v3/queue.records[].movieId",
    "GET /api/v3/queue.records[].movie",
    "GET /api/v3/manualimport[].movie"
  ]
}

const fieldOf = (drift: string) => drift.split(":")[0] ?? drift

describe("the services' specs", () => {
  for (const service of ["radarr", "sonarr"] as const) {
    const spec = specOf(service)
    const drifts = reads[service].flatMap((read) => driftOf(spec, read))

    it(`${service}: every field Quai reads is in the spec, with its type`, () => {
      expect(drifts.filter((drift) => !theOthers[service].includes(fieldOf(drift)))).toEqual([])
    })

    it(`${service}: each field left to the other service is still missing from this one`, () => {
      expect(theOthers[service].filter((field) => !drifts.map(fieldOf).includes(field))).toEqual([])
    })
  }
})
