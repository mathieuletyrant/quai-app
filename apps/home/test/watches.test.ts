import { describe, expect, it } from "@effect/vitest"
import type { Watch } from "@quai/domain/home/HomeLink.ts"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Calls } from "../src/Calls.ts"
import { Watches, type WatchEvent } from "../src/Watches.ts"

/** What the fake services answer, by path; `null` fails the call. */
let answers: Record<string, string | null> = {}
const polls: Array<string> = []
const fakeCalls = Layer.succeed(Calls, {
  run: (call) =>
    Effect.sync(() => {
      polls.push(call.path)
      const body = answers[call.path]
      return body === null || body === undefined
        ? { _tag: "Failed" as const, reason: "unreachable" }
        : { _tag: "Answered" as const, status: 200, body }
    })
})

const withWatcher = <A, E>(
  test: (
    watcher: Effect.Success<ReturnType<Watches["Service"]["make"]>>,
    sent: Array<WatchEvent>
  ) => Effect.Effect<A, E>
) =>
  Effect.gen(function*() {
    answers = {}
    polls.length = 0
    const sent: Array<WatchEvent> = []
    const watcher = yield* (yield* Watches).make((event) => Effect.sync(() => void sent.push(event)))
    return yield* test(watcher, sent)
  }).pipe(Effect.scoped, Effect.provide(Watches.layer.pipe(Layer.provide(fakeCalls))))

const sessions: Watch = { id: "w1", service: "jellyfin", path: "/Sessions", everySeconds: 15 }
const torrents: Watch = {
  id: "w2",
  service: "qbittorrent",
  path: "/api/v2/torrents/info?hashes=a",
  everySeconds: 5
}
const snapshot = (watchId: string, body: string) => ({ _tag: "Snapshot", watchId, status: 200, body })

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
      })
    ))

  it.effect("refuses a watch outside its period range, and polls the others", () =>
    withWatcher((watcher, sent) =>
      Effect.gen(function*() {
        answers["/api/v2/torrents/info?hashes=a"] = "[]"
        yield* watcher.set([
          { id: "too-fast", service: "jellyfin", path: "/Sessions", everySeconds: 1 },
          { id: "too-slow", service: "jellyfin", path: "/Sessions", everySeconds: 3601 },
          torrents
        ])
        yield* after(0)
        expect(sent).toEqual([
          { _tag: "WatchFailed", watchId: "too-fast", reason: "period out of range" },
          { _tag: "WatchFailed", watchId: "too-slow", reason: "period out of range" },
          snapshot("w2", "[]")
        ])
        expect(polls).toEqual(["/api/v2/torrents/info?hashes=a"])
      })
    ))

  it.effect("setting the watches replaces the whole set; a watch kept as it was isn't sent again", () =>
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
      })
    ))

  it.effect("after a reset, every snapshot goes out again", () =>
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
      })
    ))

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
        expect(sent).toEqual([snapshot("w1", "[]"), { _tag: "WatchFailed", watchId: "w1", reason: "unreachable" }])

        // Back with the same body: the domain hears it recovered.
        answers["/Sessions"] = "[]"
        yield* after(15)
        expect(sent.at(-1)).toEqual(snapshot("w1", "[]"))

        answers["/Sessions"] = null
        yield* after(15)
        expect(sent.filter((event) => event._tag === "WatchFailed")).toHaveLength(2)
        expect(polls).toHaveLength(6)
      })
    ))
})
