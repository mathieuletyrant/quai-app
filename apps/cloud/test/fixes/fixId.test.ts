import { describe, expect, it } from "@effect/vitest"
import * as FixId from "../../src/fixes/FixId.ts"

describe("fix ids", () => {
  it("reads back what it makes", () => {
    expect(FixId.parse(FixId.blocked("radarr", 41))).toEqual({ _tag: "Blocked", service: "radarr", queueId: 41 })
    expect(FixId.parse(FixId.blocked("sonarr", 7))).toEqual({ _tag: "Blocked", service: "sonarr", queueId: 7 })
    expect(FixId.parse(FixId.missingMovie(48))).toEqual({ _tag: "MissingMovie", movieId: 48 })
    expect(FixId.parse(FixId.missingSeason(3, 0))).toEqual({ _tag: "MissingSeason", seriesId: 3, seasonNumber: 0 })
    expect(FixId.parse(FixId.deletion(42))).toEqual({ _tag: "Deletion", candidateId: 42 })
  })

  it("names the service to read again", () => {
    expect([FixId.blocked("sonarr", 7), FixId.missingMovie(48), FixId.missingSeason(3, 2), FixId.deletion(42)].map(FixId.serviceOf))
      .toEqual(["sonarr", "radarr", "sonarr", "reclaimerr"])
  })

  it("an id Quai never made names nothing", () => {
    for (const id of ["anything", "deletion-", "deletion-x", "blocked-lidarr-1", "missing-movie-1-2", "missing-season-3"]) {
      expect(FixId.parse(id)).toBeUndefined()
      expect(FixId.serviceOf(id)).toBeUndefined()
    }
  })
})
