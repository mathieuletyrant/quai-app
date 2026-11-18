import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { DownloadActivities } from "../../src/engine/DownloadActivities.ts"
import type { Push } from "../../src/engine/DownloadEngine.ts"
import { movieKey } from "../../src/engine/Events.ts"

const dune = movieKey(438631)
const tags = (pushes: ReadonlyArray<Push>) => pushes.map((p) => p._tag)

const run = <A, E>(effect: Effect.Effect<A, E, DownloadActivities>) =>
  effect.pipe(Effect.provide(DownloadActivities.layer))

describe("download activity", () => {
  it.effect("follows a movie from the add to available, then forgets it", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities

      const added = yield* engine.handle({ _tag: "Added", mediaKey: dune, title: "Dune" })
      expect(added).toEqual([{
        _tag: "Start",
        attributes: { mediaKey: dune, title: "Dune" },
        content: { step: "searching", stalled: false }
      }])

      yield* TestClock.adjust("1 minute")
      const grabbed = yield* engine.handle({ _tag: "Grabbed", mediaKey: dune, title: "Dune", downloadId: "abc" })
      expect(grabbed).toEqual([{
        _tag: "Update",
        mediaKey: dune,
        title: "Dune",
        content: { step: "downloading", progress: 0, stalled: false }
      }])

      yield* TestClock.adjust("20 seconds")
      const progress = yield* engine.handle({
        _tag: "Progress",
        downloadId: "abc",
        progress: 0.42,
        bytesPerSecond: 8_000_000,
        remainingSeconds: 540
      })
      expect(progress).toEqual([{
        _tag: "Update",
        mediaKey: dune,
        title: "Dune",
        content: { step: "downloading", progress: 0.42, bytesPerSecond: 8_000_000, remainingSeconds: 540, stalled: false }
      }])

      yield* TestClock.adjust("10 minutes")
      expect(tags(yield* engine.handle({ _tag: "Imported", mediaKey: dune, title: "Dune" }))).toEqual(["Update"])

      yield* TestClock.adjust("2 minutes")
      const available = yield* engine.handle({ _tag: "Available", mediaKey: dune })
      expect(available).toHaveLength(1)
      const end = available[0]!
      expect(end._tag).toBe("End")
      if (end._tag === "End") {
        expect(end.content.step).toBe("available")
        expect(end.dismissAt - (yield* Effect.clockWith((c) => c.currentTimeMillis))).toBe(15 * 60_000)
      }

      yield* TestClock.adjust("15 minutes")
      yield* engine.tick
      expect((yield* engine.snapshot).activities.size).toBe(0)
    })))

  it.effect("sends at most one progress update every 15 s, and flushes the last one on tick", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities
      yield* engine.handle({ _tag: "Grabbed", mediaKey: dune, title: "Dune", downloadId: "abc" })
      const sent: Array<Push> = []
      for (let i = 1; i <= 10; i++) {
        yield* TestClock.adjust("2 seconds")
        sent.push(...(yield* engine.handle({
          _tag: "Progress",
          downloadId: "abc",
          progress: i / 100,
          bytesPerSecond: 1000,
          remainingSeconds: 100
        })))
      }
      // 20 s of progress: one update at 16 s (first after the 15 s window), the rest held back.
      expect(sent).toHaveLength(1)
      yield* TestClock.adjust("15 seconds")
      const flushed = yield* engine.tick
      expect(flushed).toHaveLength(1)
      expect(flushed[0]!._tag === "Update" && flushed[0]!.content.progress).toBe(0.1)
      expect(yield* engine.tick).toEqual([])
    })))

  it.effect("one title is one activity, even when Radarr and Seerr both report it", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities
      expect(tags(yield* engine.handle({ _tag: "Added", mediaKey: dune, title: "Dune" }))).toEqual(["Start"])
      expect(yield* engine.handle({ _tag: "Added", mediaKey: dune, title: "Dune" })).toEqual([])
      yield* engine.handle({ _tag: "Grabbed", mediaKey: dune, title: "Dune", downloadId: "abc" })
      expect(yield* engine.handle({ _tag: "Grabbed", mediaKey: dune, title: "Dune", downloadId: "abc" })).toEqual([])
      // A late "Added" never moves it back.
      expect(yield* engine.handle({ _tag: "Added", mediaKey: dune, title: "Dune" })).toEqual([])
      expect((yield* engine.snapshot).activities.size).toBe(1)
    })))

  it.effect("turns grey after 2 h without a source, and back when the download moves", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities
      yield* engine.handle({ _tag: "Grabbed", mediaKey: dune, title: "Dune", downloadId: "abc" })
      yield* TestClock.adjust("119 minutes")
      expect(yield* engine.tick).toEqual([])
      yield* TestClock.adjust("1 minute")
      const stalled = yield* engine.tick
      expect(stalled).toHaveLength(1)
      expect(stalled[0]!._tag === "Update" && stalled[0]!.content.stalled).toBe(true)

      yield* TestClock.adjust("5 seconds")
      const moving = yield* engine.handle({
        _tag: "Progress",
        downloadId: "abc",
        progress: 0.01,
        bytesPerSecond: 500,
        remainingSeconds: null
      })
      expect(moving).toHaveLength(1)
      expect(moving[0]!._tag === "Update" && moving[0]!.content.stalled).toBe(false)
    })))

  it.effect("a missed webhook is caught up: Imported without Added still starts the activity", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities
      const pushes = yield* engine.handle({ _tag: "Imported", mediaKey: dune, title: "Dune" })
      expect(pushes).toHaveLength(1)
      expect(pushes[0]!._tag === "Start" && pushes[0]!.content.step).toBe("importing")
    })))

  it.effect("ignores progress for a torrent it doesn't follow, and Available for an unknown title", () =>
    run(Effect.gen(function*() {
      const engine = yield* DownloadActivities
      expect(yield* engine.handle({
        _tag: "Progress",
        downloadId: "zzz",
        progress: 0.5,
        bytesPerSecond: 1,
        remainingSeconds: 1
      })).toEqual([])
      expect(yield* engine.handle({ _tag: "Available", mediaKey: dune })).toEqual([])
    })))
})
