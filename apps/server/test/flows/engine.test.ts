import type { Flow } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { Activities } from "../../src/flows/Activities.ts"
import type { Push } from "../../src/flows/Engine.ts"
import { download, dune, engineWith, ev, incident, playback } from "./helpers.ts"

const tags = (pushes: ReadonlyArray<Push>) => pushes.map((p) => `${p._tag}:${p.activity.stepIndex}`)

const run = <A, E>(effect: Effect.Effect<A, E, Activities>, flows?: ReadonlyArray<Flow>) =>
  effect.pipe(Effect.provide(engineWith(flows)))

describe("download flow", () => {
  it.effect("follows a movie from the add to available, then forgets it after the linger", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(tags(yield* engine.handle(ev.added()))).toEqual(["Start:0"])
      yield* TestClock.adjust("1 minute")
      expect(tags(yield* engine.handle(ev.grabbed()))).toEqual(["Update:1"])
      yield* TestClock.adjust("20 seconds")
      const progress = yield* engine.handle(ev.progress(0.42))
      expect(tags(progress)).toEqual(["Update:1"])
      expect(progress[0]!.activity.values.progress).toBe(0.42)
      yield* TestClock.adjust("10 minutes")
      expect(tags(yield* engine.handle(ev.imported()))).toEqual(["Update:2"])
      const end = yield* engine.handle(ev.available())
      expect(tags(end)).toEqual(["End:3"])
      expect(end[0]!.activity.tone).toBe("done")
      yield* TestClock.adjust("15 minutes")
      yield* engine.tick
      expect((yield* engine.snapshot).activities.size).toBe(0)
    })))

  it.effect("one push of progress every 15 s at most, the last one flushed on tick", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      const sent: Array<Push> = []
      for (let i = 1; i <= 10; i++) {
        yield* TestClock.adjust("2 seconds")
        sent.push(...(yield* engine.handle(ev.progress(i / 100))))
      }
      expect(sent).toHaveLength(1)
      yield* TestClock.adjust("15 seconds")
      const flushed = yield* engine.tick
      expect(flushed.map((p) => p.activity.values.progress)).toEqual([0.1])
      expect(yield* engine.tick).toEqual([])
    })))

  it.effect("one activity per title; never backwards; a missed webhook starts at its step", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(tags(yield* engine.handle(ev.imported()))).toEqual(["Start:2"])
      expect(yield* engine.handle(ev.added())).toEqual([])
      expect(yield* engine.handle(ev.grabbed())).toEqual([])
      expect((yield* engine.snapshot).activities.size).toBe(1)
      // Available alone, for an unknown title, starts nothing.
      expect(yield* engine.handle(ev.available({ ...dune, key: "movie:tmdb:2" }))).toEqual([])
    })))

  it.effect("grey after 2 h without progress, back when it moves", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      yield* TestClock.adjust("119 minutes")
      expect(yield* engine.tick).toEqual([])
      yield* TestClock.adjust("1 minute")
      expect((yield* engine.tick).map((p) => p.activity.tone)).toEqual(["stalled"])
      yield* TestClock.adjust("5 seconds")
      expect((yield* engine.handle(ev.progress(0.01))).map((p) => p.activity.tone)).toEqual(["active"])
    })))

  it.effect("a custom flow filtered to series ignores movies; both flows follow series", () => {
    const anime: Flow = { ...download, id: "anime", name: "Anime", builtIn: false, filter: { mediaType: "series" } }
    return run(Effect.gen(function*() {
      const engine = yield* Activities
      expect((yield* engine.handle(ev.added())).map((p) => p.activity.flowId)).toEqual(["download"])
      const show = { kind: "media" as const, key: "series:tvdb:9:dl:x", title: "Frieren · S01E01", mediaType: "series" as const }
      expect((yield* engine.handle(ev.grabbed("x", show))).map((p) => p.activity.flowId)).toEqual(["download", "anime"])
    }), [download, anime])
  })

  it.effect("a turned-off flow starts nothing", () =>
    run(Effect.gen(function*() {
      expect(yield* (yield* Activities).handle(ev.added())).toEqual([])
    }), [{ ...download, enabled: false }]))
})

describe("playback flow", () => {
  const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }

  it.effect("starts with an end time, ends on stop, or expires after 15 min without news", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      const start = yield* engine.handle({ type: "playback.started", subject: tv, values: { endsAt: 999_000 } })
      expect(tags(start)).toEqual(["Start:0"])
      expect(start[0]!.activity.values.endsAt).toBe(999_000)
      yield* TestClock.adjust("16 minutes")
      expect(tags(yield* engine.tick)).toEqual(["End:0"])
    }), [playback]))

  it.effect("filtered to a device: other devices start nothing", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(yield* engine.handle({ type: "playback.started", subject: { ...tv, device: "iPad" } })).toEqual([])
      expect(tags(yield* engine.handle({ type: "playback.started", subject: tv }))).toEqual(["Start:0"])
      expect(tags(yield* engine.handle({ type: "playback.stopped", subject: tv }))).toEqual(["End:1"])
    }), [{ ...playback, filter: { devices: ["TV Salon"] } }]))
})

describe("incident flow", () => {
  const radarr = { kind: "service" as const, key: "service:radarr", title: "Radarr" }

  it.effect("down then back; back alone starts nothing", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(yield* engine.handle({ type: "service.up", subject: radarr })).toEqual([])
      expect(tags(yield* engine.handle({ type: "service.down", subject: radarr, values: { since: 1 } }))).toEqual(["Start:0"])
      expect(tags(yield* engine.handle({ type: "service.up", subject: radarr }))).toEqual(["End:1"])
    }), [incident]))
})
