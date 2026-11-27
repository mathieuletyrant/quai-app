import { describe, expect, it } from "@effect/vitest"
import { HomeLink } from "@quai/domain/home/HomeLink.ts"
import { Effect, Fiber, Option } from "effect"
import { TestClock } from "effect/testing"
import { callTimeoutMs, makeFakeHome, recordedHome, settle, testLink } from "./fakeHome.ts"

describe("the fake Quai Home", () => {
  it.effect("answers from its recordings, 404 for the rest; offline before it connects and once gone", () =>
    Effect.gen(function*() {
      const link = yield* HomeLink
      const movies = { service: "radarr", method: "GET", path: "/api/v3/movie" } as const
      expect((yield* Effect.flip(link.call(movies))).reason).toBe("offline")
      const home = yield* makeFakeHome({ answer: recordedHome({ "radarr GET /api/v3/movie": { json: [] } }) })
      yield* home.connect
      expect(yield* link.call(movies)).toEqual({ status: 200, body: "[]" })
      expect(yield* link.call({ service: "radarr", method: "GET", path: "/api/v3/queue" })).toEqual({
        status: 404,
        body: ""
      })
      expect(home.calls.map((call) => call.path)).toEqual(["/api/v3/movie", "/api/v3/queue"])
      yield* home.disconnect
      expect(yield* link.home).toEqual(Option.none())
      expect((yield* Effect.flip(link.call(movies))).reason).toBe("offline")
    }).pipe(Effect.provide(testLink)))

  it.effect("a silent answer times out, a failure is one, a drop takes the home away", () =>
    Effect.gen(function*() {
      const link = yield* HomeLink
      const home = yield* makeFakeHome({
        answer: recordedHome({
          "jellyfin GET /Sessions": { silent: true },
          "radarr GET /api/v3/queue": { failed: "unreachable" },
          "sonarr GET /api/v3/queue": { drop: true }
        })
      })
      yield* home.connect
      const waiting = yield* Effect.forkChild(
        Effect.flip(link.call({ service: "jellyfin", method: "GET", path: "/Sessions" }))
      )
      yield* settle
      yield* TestClock.adjust(callTimeoutMs)
      expect((yield* Fiber.join(waiting)).reason).toBe("timeout")
      expect(yield* Effect.flip(link.call({ service: "radarr", method: "GET", path: "/api/v3/queue" }))).toMatchObject({
        reason: "failed",
        message: "unreachable"
      })
      expect((yield* Effect.flip(link.call({ service: "sonarr", method: "GET", path: "/api/v3/queue" }))).reason).toBe(
        "offline"
      )
      yield* settle
      expect(yield* link.home).toEqual(Option.none())
    }).pipe(Effect.provide(testLink)))

  it.effect("tells the domain it is up, what it hears on its own, and that it is gone; nothing while away", () =>
    Effect.gen(function*() {
      const link = yield* HomeLink
      const home = yield* makeFakeHome({ services: ["radarr"] })
      yield* home.webhook("radarr", { eventType: "Test" })
      yield* home.connect
      expect(yield* link.nextEvent).toEqual({ _tag: "Ready", home: { homeId: home.homeId, services: ["radarr"] } })
      yield* link.setWatches([{ id: "w", service: "radarr", path: "/api/v3/queue", everySeconds: 15 }])
      expect(home.watch("w")?.path).toBe("/api/v3/queue")
      yield* home.snapshot("w", [])
      yield* home.failWatch("w")
      yield* home.webhook("radarr", { eventType: "Test" })
      expect(yield* link.nextEvent).toEqual({ _tag: "Snapshot", watchId: "w", status: 200, body: "[]" })
      expect(yield* link.nextEvent).toEqual({ _tag: "WatchFailed", watchId: "w", reason: "unreachable" })
      expect(yield* link.nextEvent).toMatchObject({ _tag: "Webhook", service: "radarr" })
      yield* home.disconnect
      expect(yield* link.nextEvent).toEqual({ _tag: "Gone", homeId: home.homeId })
      expect(home.state.watches).toEqual([])
      expect((yield* Effect.flip(link.documents.put("settings", {}))).reason).toBe("offline")
    }).pipe(Effect.provide(testLink)))

  it.effect("keeps its documents and journal across a disconnection, like its disk", () =>
    Effect.gen(function*() {
      const link = yield* HomeLink
      const home = yield* makeFakeHome()
      yield* home.connect
      yield* link.documents.put("flows/anime", { id: "anime" })
      yield* link.appendJournal([{ id: "1", at: 0, level: "info", source: "home", kind: "test", text: "kept" }])
      yield* home.disconnect
      yield* home.connect
      expect(yield* link.documents.get("flows/anime")).toEqual(Option.some({ id: "anime" }))
      expect((yield* link.readJournal({ limit: 5 })).entries.map((entry) => entry.text)).toEqual(["kept"])
      expect(home.received.map((use) => use._tag)).toEqual(["StorePut", "JournalAppend", "JournalRead"])
    }).pipe(Effect.provide(testLink)))
})
