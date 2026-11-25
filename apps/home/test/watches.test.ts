import { describe, expect, it } from "@effect/vitest"
import type { HomeProtocol } from "@quai/api"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Calls } from "../src/Calls.ts"
import { Watches } from "../src/Watches.ts"
import { journalLayer } from "./config.ts"

/** What the fake services answer, by path; `null` fails the call. */
let answers: Record<string, string | null> = {}
const polls: Array<string> = []
const fakeCalls = Layer.succeed(Calls, {
  run: (call) =>
    Effect.sync(() => {
      polls.push(call.path)
      const body = answers[call.path]
      return body === null || body === undefined
        ? { _tag: "Failed" as const, id: call.id, reason: "unreachable" }
        : { _tag: "CallResponse" as const, id: call.id, status: 200, body }
    })
})

const withWatcher = <A, E>(test: (watcher: Effect.Success<ReturnType<Watches["Service"]["make"]>>, sent: Array<HomeProtocol.HomeMessage>) => Effect.Effect<A, E>) =>
  Effect.gen(function*() {
    answers = {}
    polls.length = 0
    const sent: Array<HomeProtocol.HomeMessage> = []
    const watcher = yield* (yield* Watches).make((message) => Effect.sync(() => void sent.push(message)))
    return yield* test(watcher, sent)
  }).pipe(Effect.scoped, Effect.provide(Watches.layer.pipe(Layer.provide([fakeCalls, journalLayer]))))

const sessions: HomeProtocol.Watch = { id: "w1", service: "jellyfin", path: "/Sessions", everySeconds: 15 }
const torrents: HomeProtocol.Watch = { id: "w2", service: "qbittorrent", path: "/api/v2/torrents/info?hashes=a", everySeconds: 5 }
const snapshot = (watchId: string, body: string) => ({ _tag: "WatchSnapshot", watchId, status: 200, body })

const after = (seconds: number) => TestClock.adjust(`${seconds} seconds`)

describe("watches", () => {
  it.effect("polls right away then every period, and sends a snapshot only when it changed", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/Sessions"] = "[]"
        yield* watcher.set([sessions])
        yield* after(0)
        expect(polls).toEqual(["/Sessions"])
        expect(sent).toEqual([snapshot("w1", "[]")])

        yield* after(14)
        expect(polls).toHaveLength(1)
        yield* after(1)
        expect(polls).toHaveLength(2)
        expect(sent).toHaveLength(1)

        answers["/Sessions"] = "[{\"Id\":\"s\"}]"
        yield* after(15)
        expect(sent).toEqual([snapshot("w1", "[]"), snapshot("w1", "[{\"Id\":\"s\"}]")])
      })))

  it.effect("refuses a watch outside the allowlist or its period range, and polls the others", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/api/v2/torrents/info?hashes=a"] = "[]"
        yield* watcher.set([
          { id: "bad", service: "radarr", path: "/api/v3/config/host", everySeconds: 5 },
          { id: "post-only", service: "jellyfin", path: "/Sessions/x/Playing/Stop", everySeconds: 5 },
          { id: "too-fast", service: "jellyfin", path: "/Sessions", everySeconds: 1 },
          torrents
        ])
        yield* after(0)
        expect(sent).toEqual([
          { _tag: "Failed", id: "bad", reason: "not allowed" },
          { _tag: "Failed", id: "post-only", reason: "not allowed" },
          { _tag: "Failed", id: "too-fast", reason: "period out of range" },
          snapshot("w2", "[]")
        ])
        expect(polls).toEqual(["/api/v2/torrents/info?hashes=a"])
      })))

  it.effect("SetWatches replaces the whole set; a watch kept as it was isn't sent again", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/Sessions"] = "[]"
        answers["/api/v2/torrents/info?hashes=a"] = "[]"
        yield* watcher.set([sessions, torrents])
        yield* after(0)
        expect(sent).toHaveLength(2)

        yield* watcher.set([torrents])
        yield* after(0)
        expect(sent).toHaveLength(2)
        polls.length = 0
        yield* after(15)
        expect(polls.every((path) => path !== "/Sessions")).toBe(true)
        expect(polls.length).toBe(3)
      })))

  it.effect("after a reset (a new Welcome), every snapshot goes out again", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/Sessions"] = "[]"
        yield* watcher.set([sessions])
        yield* after(0)
        yield* watcher.reset
        polls.length = 0
        yield* after(30)
        expect(polls).toEqual([])

        yield* watcher.set([sessions])
        yield* after(0)
        expect(sent).toEqual([snapshot("w1", "[]"), snapshot("w1", "[]")])
      })))

  it.effect("a failing watch reports once per failure streak and keeps polling", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/Sessions"] = "[]"
        yield* watcher.set([sessions])
        yield* after(0)
        answers["/Sessions"] = null
        yield* after(15)
        yield* after(15)
        yield* after(15)
        expect(sent).toEqual([snapshot("w1", "[]"), { _tag: "Failed", id: "w1", reason: "unreachable" }])

        // Back with the same body: the cloud hears it recovered.
        answers["/Sessions"] = "[]"
        yield* after(15)
        expect(sent.at(-1)).toEqual(snapshot("w1", "[]"))

        answers["/Sessions"] = null
        yield* after(15)
        expect(sent.filter((message) => message._tag === "Failed")).toHaveLength(2)
        expect(polls).toHaveLength(6)
      })))
})
