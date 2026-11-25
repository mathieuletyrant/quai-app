import type { Flow } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Activities } from "../../src/flows/Activities.ts"
import { emptyState, onEvent, onTick, type Push } from "../../src/flows/Engine.ts"
import { settle } from "../fakeHome.ts"
import { type Subject, widenLookup } from "../../src/flows/Events.ts"
import { download, dune, engineWith, ev, playback, requestFlow } from "./helpers.ts"

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
      yield* engine.tick()
      expect((yield* engine.snapshot).activities.size).toBe(0)
    })))

  it.effect("one push of progress every 5 s at most, the last one flushed on tick", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      const sent: Array<Push> = []
      for (let i = 1; i <= 12; i++) {
        yield* TestClock.adjust("1 second")
        sent.push(...(yield* engine.handle(ev.progress(i / 100))))
      }
      // The grab went at 0 s: then 5 s, 10 s.
      expect(sent.map((p) => p.activity.values.progress)).toEqual([0.05, 0.1])
      yield* TestClock.adjust("2 seconds")
      expect(yield* engine.tick()).toEqual([])
      yield* TestClock.adjust("1 second")
      const flushed = yield* engine.tick()
      expect(flushed.map((p) => p.activity.values.progress)).toEqual([0.12])
      expect(yield* engine.tick()).toEqual([])
    })))

  it.effect("an ETA that turns unknown clears the last one", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      yield* TestClock.adjust("10 seconds")
      expect((yield* engine.handle(ev.progress(0.3)))[0]!.activity.values.remainingSeconds).toBe(60)
      yield* TestClock.adjust("10 seconds")
      const paused = yield* engine.handle({ type: "download.progress", downloadId: "abc", values: { progress: 0.31, bytesPerSecond: 0 } })
      expect(paused[0]!.activity.values.remainingSeconds).toBeUndefined()
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

  it.effect("a season pack imported one episode at a time keeps its title and waits for every episode", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      const episodes = (...numbers: ReadonlyArray<number>) => numbers.map((episode) => ({ season: 1, episode }))
      const pack = (title: string, ...numbers: ReadonlyArray<number>): Subject => ({
        kind: "media",
        key: "series:tvdb:407046:dl:abc",
        title,
        mediaType: "series",
        lookup: { _tag: "Episodes", tvdbId: 407046, title: "Our House (2022)", episodes: episodes(...numbers) }
      })
      expect(tags(yield* engine.handle(ev.grabbed("abc", pack("Our House (2022) · S01", 1, 2, 3, 4))))).toEqual(["Start:1"])
      const imported = yield* engine.handle(ev.imported(pack("Our House (2022) · S01E03", 3)))
      expect(tags(imported)).toEqual(["Update:2"])
      expect(imported[0]!.activity.title).toBe("Our House (2022) · S01")
      yield* engine.handle(ev.imported(pack("Our House (2022) · S01E02", 2)))
      const [activity] = (yield* engine.snapshot).activities.values()
      expect(activity!.title).toBe("Our House (2022) · S01")
      expect(activity!.lookup).toMatchObject({ episodes: episodes(1, 2, 3, 4) })
    })))

  it("a lookup keeps the ids it had and takes the ones a later event brings", () => {
    const one = { _tag: "Episodes" as const, tvdbId: 1, title: "Show", episodes: [{ season: 1, episode: 1 }] }
    expect(widenLookup(one, { ...one, tmdbId: 2, imdbId: "tt3" })).toEqual({ ...one, tmdbId: 2, imdbId: "tt3" })
    expect(widenLookup({ ...one, tmdbId: 2 }, one)).toEqual({ ...one, tmdbId: 2 })
  })

  it.effect("a later event about more episodes widens what the activity follows", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      const one = (episode: number): Subject => ({
        kind: "media",
        key: "series:tvdb:1:dl:abc",
        title: `Show · S01E0${episode}`,
        mediaType: "series",
        lookup: { _tag: "Episodes", tvdbId: 1, title: "Show", episodes: [{ season: 1, episode }] }
      })
      yield* engine.handle(ev.imported(one(1)))
      yield* engine.handle(ev.imported(one(2)))
      const [activity] = (yield* engine.snapshot).activities.values()
      expect(activity!.lookup).toMatchObject({ episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] })
    })))

  it.effect("a blocked import turns the activity grey at once with its reason, until it's imported", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      yield* engine.handle(ev.progress(1))
      yield* TestClock.adjust("1 second")
      const blocked = yield* engine.handle({ type: "media.importBlocked", subject: dune, values: { detail: "Import blocked · see To fix" } })
      expect(tags(blocked)).toEqual(["Update:1"])
      expect(blocked[0]!.activity.tone).toBe("stalled")
      expect(blocked[0]!.activity.values.detail).toBe("Import blocked · see To fix")
      // The finished torrent still reports: it stays grey.
      yield* TestClock.adjust("10 seconds")
      yield* engine.handle(ev.progress(1))
      const [held] = (yield* engine.snapshot).activities.values()
      expect(held!.tone).toBe("stalled")
      const imported = yield* engine.handle(ev.imported())
      expect(tags(imported)).toEqual(["Update:2"])
      expect(imported[0]!.activity.tone).toBe("active")
      expect(imported[0]!.activity.values.detail).toBeUndefined()
    })))

  it.effect("a download gone from the client ends its activity grey; the next grab starts its own", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed("first"))
      yield* TestClock.adjust("2 minutes")
      const removed = yield* engine.handle({ type: "download.removed", downloadId: "first", values: { detail: "Removed from the download client" } })
      expect(tags(removed)).toEqual(["End:1"])
      expect(removed[0]!.activity.tone).toBe("stalled")
      expect(removed[0]!.activity.values.detail).toBe("Removed from the download client")
      // Another download's removal leaves it alone, and so does a second one.
      expect(yield* engine.handle({ type: "download.removed", downloadId: "first" })).toEqual([])
      const regrab = yield* engine.handle(ev.grabbed("second"))
      expect(regrab.map((p) => [p._tag, p.activity.downloadId])).toEqual([["Start", "second"]])
    })))

  it.effect("grey after 2 h without progress, back when it moves", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.grabbed())
      yield* TestClock.adjust("119 minutes")
      expect(yield* engine.tick()).toEqual([])
      yield* TestClock.adjust("1 minute")
      expect((yield* engine.tick()).map((p) => p.activity.tone)).toEqual(["stalled"])
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

  it.effect("pushes leave in the order the engine made them, even from two fibers (verify skill: live-activity-pushes)", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      const sent: Array<string> = []
      const apnsBusy = yield* Deferred.make<void>()
      const slowSend = (pushes: ReadonlyArray<Push>) => Effect.andThen(Deferred.await(apnsBusy), Effect.sync(() => sent.push(...tags(pushes))))
      const send = (pushes: ReadonlyArray<Push>) => Effect.sync(() => sent.push(...tags(pushes)))
      const first = yield* Effect.forkChild(engine.handle(ev.added(), slowSend))
      yield* settle
      const second = yield* Effect.forkChild(engine.handle(ev.grabbed(), send))
      yield* settle
      // The second change waits for the first one's pushes to leave.
      expect(sent).toEqual([])
      yield* Deferred.succeed(apnsBusy, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(sent).toEqual(["Start:0", "Update:1"])
    })))

  it.effect("a turned-off flow starts nothing", () =>
    run(Effect.gen(function*() {
      expect(yield* (yield* Activities).handle(ev.added())).toEqual([])
    }), [{ ...download, enabled: false }]))
})

describe("playback flow", () => {
  const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }
  const playing = (endsAt: number) => ({ type: "playback.started" as const, subject: tv, values: { paused: false, startsAt: 0, endsAt } })
  const position = (values: object) => ({ type: "playback.progress" as const, subject: tv, values })

  it.effect("one step that stays while playing, and ends on stop", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      const start = yield* engine.handle(playing(999_000))
      expect(tags(start)).toEqual(["Start:0"])
      expect(start[0]!.activity.endedAt).toBeNull()
      const stop = yield* engine.handle({ type: "playback.stopped", subject: tv })
      expect(tags(stop)).toEqual(["End:0"])
      expect(stop[0]!.activity.tone).toBe("done")
    }), [playback]))

  it.effect("the end time drifting by milliseconds pushes nothing; a pause goes at once; a seek within 5 s", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(playing(3_600_000))
      yield* TestClock.adjust("15 seconds")
      expect(yield* engine.handle(position({ paused: false, startsAt: 3, endsAt: 3_600_004 }))).toEqual([])
      yield* TestClock.adjust("1 second")
      const paused = yield* engine.handle(position({ paused: true, progress: 0.25 }))
      expect(paused.map((p) => p.activity.values.paused)).toEqual([true])
      yield* TestClock.adjust("1 second")
      expect((yield* engine.handle(position({ paused: false, startsAt: 0, endsAt: 3_000_000 }))).length).toBe(1)
    }), [playback]))

  it.effect("expires after 15 min without news", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(playing(999_000))
      yield* TestClock.adjust("16 minutes")
      expect(tags(yield* engine.tick())).toEqual(["End:0"])
    }), [playback]))

  it.effect("filtered to a device: other devices start nothing", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(yield* engine.handle({ type: "playback.started", subject: { ...tv, device: "iPad" } })).toEqual([])
      expect(tags(yield* engine.handle({ type: "playback.started", subject: tv }))).toEqual(["Start:0"])
    }), [{ ...playback, filter: { devices: ["TV Salon"] } }]))
})

describe("request flow", () => {
  const dune = { kind: "request" as const, key: "request:1", title: "Dune", mediaType: "movie" as const, requester: "Julie" }

  it.effect("pending then approved; approved alone starts nothing", () =>
    run(Effect.gen(function*() {
      const engine = yield* Activities
      expect(yield* engine.handle({ type: "request.approved", subject: dune })).toEqual([])
      expect(tags(yield* engine.handle({ type: "request.pending", subject: dune }))).toEqual(["Start:0"])
      expect(tags(yield* engine.handle({ type: "request.approved", subject: dune }))).toEqual(["End:1"])
    }), [requestFlow]))
})

describe("a flow edited under a running activity", () => {
  // The download flow with only its first two steps: an activity on "imported" (2) lost its step.
  const shortened: Flow = { ...download, steps: download.steps.slice(0, 2) }
  const onImported = onEvent(emptyState, [download], ev.imported(), 0).state

  it("a tick ends it and forgets it, like a deleted flow", () => {
    const { pushes, state } = onTick(onImported, [shortened], 1_000)
    expect(tags(pushes)).toEqual(["End:2"])
    expect(state.activities.size).toBe(0)
  })

  it("a data event ends it and forgets it", () => {
    const { pushes, state } = onEvent(onImported, [shortened], ev.progress(0.5), 1_000)
    expect(tags(pushes)).toEqual(["End:2"])
    expect(state.activities.size).toBe(0)
  })
})

describe("a flow disabled under a running activity", () => {
  const disabled: Flow = { ...download, enabled: false }
  const onGrabbed = onEvent(emptyState, [download], ev.grabbed(), 0).state

  it("a tick ends it and forgets it", () => {
    const { pushes, state } = onTick(onGrabbed, [disabled], 1_000)
    expect(tags(pushes)).toEqual(["End:1"])
    expect(state.activities.size).toBe(0)
  })

  it("a data event ends it instead of updating it", () => {
    const { pushes, state } = onEvent(onGrabbed, [disabled], ev.progress(0.5), 1_000)
    expect(tags(pushes)).toEqual(["End:1"])
    expect(state.activities.size).toBe(0)
  })
})
