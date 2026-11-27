import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol, journalId } from "@quai/api"
import { Context, Effect, Fiber, Layer, Option, Queue } from "effect"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { Calls } from "../src/Calls.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { HomeStore } from "../src/HomeStore.ts"
import { Journal } from "../src/Journal.ts"
import { callConcurrency, LocalHome, openPairingHashes, startingMessage } from "../src/LocalHome.ts"
import { ServiceSettings } from "../src/ServiceSettings.ts"
import { Watches } from "../src/Watches.ts"
import { configLayer, journalLayer, NodeFileSystem, tempDir } from "./config.ts"
import { settle } from "./fakeCloud.ts"

/**
 * Every call the home made to a service, answered 200 with its path; Jellyfin's is unreachable, and
 * Seerr takes a second, to count the calls in flight.
 */
const called: Array<HomeProtocol.Call> = []
const inFlight = { now: 0, most: 0 }
const answerOf = (call: HomeProtocol.Call) =>
  call.service === "jellyfin"
    ? HomeProtocol.Failed.make({ id: call.id, reason: "jellyfin is unreachable" })
    : HomeProtocol.CallResponse.make({ id: call.id, status: 200, body: call.path })
const calls = Layer.sync(Calls, () => {
  called.length = 0
  inFlight.now = 0
  inFlight.most = 0
  return {
    run: (call) =>
      Effect.gen(function*() {
        called.push(call)
        if (call.service !== "seerr") return answerOf(call)
        inFlight.most = Math.max(inFlight.most, ++inFlight.now)
        yield* Effect.sleep("1 second")
        inFlight.now--
        return answerOf(call)
      })
  }
})

const config = configLayer({ sonarr: null })

/** The home answered in place, on a real store, key and journal in a temporary directory. */
const local = LocalHome.layer.pipe(
  Layer.provideMerge(Watches.layer),
  Layer.provideMerge(calls),
  Layer.provideMerge(Layer.mergeAll(
    Layer.effect(HomeKey, Effect.flatMap(tempDir, (dir) => HomeKey.make(join(dir, "home.key")))),
    Layer.effect(HomeStore, Effect.flatMap(tempDir, (dir) => HomeStore.make(join(dir, "home")))),
    Layer.effect(ServiceSettings, Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json"))))
  )),
  Layer.provideMerge(journalLayer),
  Layer.provide([config, NodeFileSystem.layer])
)

const reached = ["radarr", "qbittorrent", "jellyfin", "reclaimerr", "seerr", "cleanuparr", "prowlarr"]

describe("the home, answered in place", () => {
  it.effect("is this home, never offline: its id, the services it reaches, where an iPhone opens them", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      const key = yield* HomeKey
      const home = {
        homeId: key.homeId,
        services: reached,
        protocol: HomeProtocol.protocolVersion,
        webUrls: { radarr: ["http://umbrel.local:7878", "https://radarr.example.com"] }
      }
      expect(link.homeId).toBe(key.homeId)
      expect(yield* link.home).toEqual(Option.some(home))
      // What starts the domain's Hub: the home is ready as soon as there is one.
      expect(yield* link.nextEvent).toEqual({ _tag: "Ready", home })
    }).pipe(Effect.provide(local)))

  it.effect("a service set from the console is an event: the domain hears which services the home reaches now", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      yield* link.nextEvent
      yield* (yield* ServiceSettings).save("sonarr", { url: "http://sonarr:8989", secret: "k" })
      const event = yield* link.nextEvent
      expect(event).toMatchObject({ _tag: "Services", home: { services: ["radarr", "sonarr", ...reached.slice(1)] } })
      expect(Option.getOrThrow(yield* link.home).services).toContain("sonarr")
    }).pipe(Effect.provide(local)))

  it.effect("calls the services through Quai Home's own calls; one that failed fails with its reason", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      expect(yield* link.call({ service: "radarr", method: "GET", path: "/api/v3/movie" })).toEqual({
        status: 200,
        body: "/api/v3/movie"
      })
      const failed = yield* Effect.flip(link.call({ service: "jellyfin", method: "GET", path: "/Sessions" }))
      expect(failed).toMatchObject({ _tag: "HomeError", reason: "failed", message: "jellyfin is unreachable" })
      expect(called.map((call) => `${call.service} ${call.method} ${call.path}`)).toEqual([
        "radarr GET /api/v3/movie",
        "jellyfin GET /Sessions"
      ])
      expect(new Set(called.map((call) => call.id)).size).toBe(2)
    }).pipe(Effect.provide(local)))

  it.effect("makes a few calls at once, the others wait their turn", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      const asked = yield* Effect.forkChild(
        Effect.forEach(
          Array.from({ length: callConcurrency * 3 }, (_, index) => index),
          (index) => link.call({ service: "seerr", method: "GET", path: `/api/v1/request/${index}` }),
          { concurrency: "unbounded" }
        )
      )
      yield* settle
      expect(inFlight.most).toBe(callConcurrency)
      yield* TestClock.adjust("3 seconds")
      expect(yield* Fiber.join(asked)).toHaveLength(callConcurrency * 3)
      expect(inFlight.most).toBe(callConcurrency)
    }).pipe(Effect.provide(local)))

  it.effect("keeps the documents in the home store: another start reads them back", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      yield* link.documents.put("devices/a", { id: "a", name: "iPhone" })
      yield* link.documents.put("flows/download", { on: true })
      yield* link.documents.put("devices/b", { id: "b" })
      yield* link.documents.delete("devices/b")
      expect(yield* link.documents.get("devices/a")).toEqual(Option.some({ id: "a", name: "iPhone" }))
      expect(yield* link.documents.get("devices/b")).toEqual(Option.none())
      expect((yield* link.documents.list("devices/")).map((document) => document.key)).toEqual(["devices/a"])
      const store = yield* HomeStore
      expect((yield* store.list("")).map((document) => document.key)).toEqual(["devices/a", "flows/download"])

      // The same store, started again: what was kept is there.
      const restarted = Context.get(yield* Layer.build(LocalHome.layer.pipe(Layer.provide(config))), LocalHome)
      expect((yield* restarted.link.documents.list("")).map((document) => document.key)).toEqual([
        "devices/a",
        "flows/download"
      ])
    }).pipe(Effect.provide(local)))

  it.effect("polls the watches itself: a snapshot when the answer changed, a failure for a watch it refuses", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      yield* link.nextEvent
      yield* link.setWatches([
        { id: "sessions", service: "radarr", path: "/api/v3/queue", everySeconds: 15 },
        { id: "config", service: "radarr", path: "/api/v3/config/host", everySeconds: 15 }
      ])
      const events = [yield* link.nextEvent, yield* link.nextEvent]
      expect(events).toContainEqual({ _tag: "WatchFailed", watchId: "config", reason: "not allowed" })
      expect(events).toContainEqual({ _tag: "Snapshot", watchId: "sessions", status: 200, body: "/api/v3/queue" })
      // The same answer again is no event; no watch, no poll.
      yield* TestClock.adjust("15 seconds")
      yield* settle
      const polls = called.length
      yield* link.setWatches([])
      yield* TestClock.adjust("1 minute")
      expect(called).toHaveLength(polls)
    }).pipe(Effect.provide(local)))

  it.effect("a webhook a service sent is an event, as it came", () =>
    Effect.gen(function*() {
      const home = yield* LocalHome
      yield* home.link.nextEvent
      yield* home.webhook("sonarr", 1234, { eventType: "Download" })
      expect(yield* home.link.nextEvent).toEqual({
        _tag: "Webhook",
        service: "sonarr",
        receivedAt: 1234,
        body: { eventType: "Download" }
      })
    }).pipe(Effect.provide(local)))

  it.effect("the journal is Quai Home's: the domain's lines are kept there, Quai Home's own are events", () =>
    Effect.gen(function*() {
      const { link } = yield* LocalHome
      yield* link.nextEvent
      const line = {
        id: journalId(1_000, "c", 1),
        at: 1_000,
        level: "info",
        source: "radarr",
        kind: "media.grabbed",
        text: "Dune grabbed"
      } as const
      yield* link.appendJournal([line])
      expect(yield* link.readJournal({ limit: 10 })).toEqual({ entries: [line], more: false })
      yield* (yield* Journal).note({ level: "warn", source: "radarr", kind: "call.refused", text: "refused" })
      const event = yield* link.nextEvent
      expect(event._tag === "Journal" ? event.entries.map((entry) => entry.text) : event).toEqual(["refused"])
    }).pipe(Effect.provide(local)))

  it.effect("the console's requests wait for the domain's routes: 503 until they answer", () =>
    Effect.gen(function*() {
      const home = yield* LocalHome
      const request = { method: "GET", path: "/console-api/devices" } as const
      expect(yield* home.console(request)).toEqual({
        status: 503,
        body: JSON.stringify({ _tag: "HomeOffline", message: startingMessage })
      })
      yield* home.link.answerConsole((asked) => Effect.succeed({ status: 200, body: JSON.stringify(asked.path) }))
      expect(yield* home.console(request)).toEqual({ status: 200, body: "\"/console-api/devices\"" })
    }).pipe(Effect.provide(local)))
})

describe("open pairing codes", () => {
  it("are the pairing documents not expired, by their hashes, sorted", () => {
    const documents = new Map<string, unknown>([
      ["pairing/bbb", { expiresAt: 2_000 }],
      ["pairing/aaa", { expiresAt: 1_000 }],
      ["pairing/old", { expiresAt: 999 }],
      ["pairing/odd", "not a pairing"],
      ["devices/x", { expiresAt: 5_000 }]
    ])
    expect(openPairingHashes(documents, 1_000)).toEqual(["aaa", "bbb"])
    expect(openPairingHashes(new Map(), 0)).toEqual([])
  })

  it.effect("a code opening or spent wakes the link to the Cloud; any other document doesn't", () =>
    Effect.gen(function*() {
      const home = yield* LocalHome
      yield* TestClock.setTime(1_000)
      const woken = yield* Queue.unbounded<ReadonlyArray<string>>()
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            home.pairingChanged,
            Effect.flatMap(home.pairingHashes, (hashes) => Queue.offer(woken, hashes))
          )
        )
      )
      yield* home.link.documents.put("pairing/aaa", { expiresAt: 5_000 })
      expect(yield* Queue.take(woken)).toEqual(["aaa"])
      yield* home.link.documents.put("devices/x", { id: "x" })
      yield* settle
      expect(yield* Queue.size(woken)).toBe(0)
      yield* home.link.documents.delete("pairing/aaa")
      expect(yield* Queue.take(woken)).toEqual([])
    }).pipe(Effect.provide(local)))
})
