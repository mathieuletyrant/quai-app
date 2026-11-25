import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit } from "effect"
import { HomeLink } from "../src/home/HomeLink.ts"
import { makeFakeHome, recordedHome, settle, testLink } from "./fakeHome.ts"

describe("the fake Quai Home", () => {
  it.effect("refuses what the real allowlist refuses, as Quai Home does: Failed \"not allowed\"", () =>
    Effect.gen(function*() {
      const link = yield* HomeLink
      const home = yield* makeFakeHome({
        strict: false,
        services: ["radarr", "seerr"],
        protocol: 2,
        answer: recordedHome({ "radarr GET /api/v3/movie": { json: [] }, "seerr GET /api/v1/status": { json: {} } })
      })
      yield* home.connect
      expect(yield* link.call({ service: "radarr", method: "GET", path: "/api/v3/movie" })).toEqual({
        status: 200,
        body: "[]"
      })
      const refusals = [
        // A path the allowlist doesn't have.
        { service: "radarr", method: "GET", path: "/api/v3/config/host" },
        // A body the rule doesn't take.
        { service: "radarr", method: "POST", path: "/api/v3/command", body: { name: "Backup" } },
        // Seerr came with protocol 3: a Home of protocol 2 refuses it.
        { service: "seerr", method: "GET", path: "/api/v1/status" }
      ] as const
      for (const call of refusals) {
        expect(yield* Effect.flip(link.call(call))).toMatchObject({ reason: "failed", message: "not allowed" })
      }
      yield* link.setWatches([{ id: "w", service: "radarr", path: "/api/v3/system/backup", everySeconds: 60 }])
      yield* settle
      expect(home.notAllowed).toEqual([
        "radarr GET /api/v3/config/host",
        "radarr POST /api/v3/command",
        "seerr GET /api/v1/status",
        "watch w: radarr GET /api/v3/system/backup"
      ])
    }).pipe(Effect.provide(testLink)))

  it.effect("strict, it fails the test that sent a refused call", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
        const home = yield* makeFakeHome()
        yield* home.connect
        yield* Effect.ignore((yield* HomeLink).call({ service: "sonarr", method: "DELETE", path: "/api/v3/series/3" }))
      })))
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("sonarr DELETE /api/v3/series/3")
    }).pipe(Effect.provide(testLink)))
})
