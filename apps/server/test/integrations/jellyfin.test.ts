import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { Activity } from "../../src/flows/Engine.ts"
import { jellyfin, playbackEvents, sessionOf } from "../../src/integrations/jellyfin.ts"
import { Jellyfin, type PlaybackCommand, playingFrom } from "../../src/stack/Jellyfin.ts"
import { download, playback } from "../flows/helpers.ts"

const sessions = [{
  Id: "s1",
  DeviceName: "TV Salon",
  NowPlayingItem: { Id: "i1", Name: "Who Is Alive?", SeriesName: "Severance", ParentIndexNumber: 2, IndexNumber: 3, RunTimeTicks: 36_000_000_000 },
  PlayState: { PositionTicks: 12_000_000_000, IsPaused: false }
}, { Id: "idle", DeviceName: "iPad" }]

const activity = (over: Partial<Activity>): Activity => ({
  key: "k",
  flowId: "download",
  subjectKey: "movie:tmdb:1",
  title: "Dune",
  stepIndex: 2,
  tone: "active",
  values: {},
  downloadId: null,
  lookup: null,
  enteredAt: 0,
  movedAt: 0,
  lastEventAt: 0,
  endedAt: null,
  pushedAt: 0,
  pushedFingerprint: null,
  ...over
})

describe("Jellyfin sessions", () => {
  it("reads what plays, with position and runtime", () => {
    expect(playingFrom(sessions)).toEqual([{
      key: "playback:s1:i1",
      title: "Severance · S02E03",
      device: "TV Salon",
      paused: false,
      remainingMs: 2_400_000,
      positionMs: 1_200_000,
      runtimeMs: 3_600_000
    }])
  })

  it("started with a timeline, then position, then stopped; paused holds the fraction", () => {
    const now = playingFrom(sessions)
    const first = playbackEvents(new Map(), now, 1_000)
    expect(first.map((e) => e.type)).toEqual(["playback.started"])
    expect(first[0]!.values).toEqual({ paused: false, detail: "TV Salon", endsAt: 2_401_000, startsAt: -1_199_000 })
    const paused = playbackEvents(new Map(), [{ ...now[0]!, paused: true }], 1_000)
    expect(paused[0]!.values).toEqual({ paused: true, detail: "TV Salon", progress: 1 / 3 })
    const before = new Map(now.map((p) => [p.key, p]))
    expect(playbackEvents(before, now, 2_000).map((e) => e.type)).toEqual(["playback.progress"])
    expect(playbackEvents(before, [], 3_000).map((e) => e.type)).toEqual(["playback.stopped"])
  })

  it("reads the session from a playback subject", () => {
    expect(sessionOf("playback:abc:item")).toBe("abc")
    expect(sessionOf("movie:tmdb:1")).toBeNull()
  })
})

describe("Jellyfin integration", () => {
  const sent: Array<[string, PlaybackCommand]> = []
  let available = false
  const client = Layer.succeed(Jellyfin, {
    configured: true,
    find: () => Effect.succeed(available ? "item" : null),
    playing: Effect.succeed(playingFrom(sessions)),
    command: (session, command) => Effect.sync(() => void sent.push([session, command]))
  })
  const run = <A, E>(effect: Effect.Effect<A, E, Jellyfin>) => effect.pipe(Effect.provide(client))
  const poller = (name: string) => Effect.map(jellyfin, (i) => i.pollers.find((p) => p.name === name)!)

  it.effect("availability: only while an activity awaits it with a lookup; available once found", () =>
    run(Effect.gen(function*() {
      const p = yield* poller("availability")
      const waiting = activity({ lookup: { _tag: "Movie", tmdbId: 1, title: "Dune" } })
      expect(p.needed({ flows: [download], running: [activity({})] })).toBe(false)
      expect(p.needed({ flows: [download], running: [waiting] })).toBe(true)
      expect(yield* p.run({ flows: [download], running: [waiting] })).toEqual([])
      available = true
      const events = yield* p.run({ flows: [download], running: [waiting] })
      expect(events.map((e) => [e.type, e.subject?.key])).toEqual([["media.available", "movie:tmdb:1"]])
    })))

  it.effect("playback: only with a playback flow on; started, then position", () =>
    run(Effect.gen(function*() {
      const p = yield* poller("playback")
      expect(p.needed({ flows: [download], running: [] })).toBe(false)
      expect(p.needed({ flows: [playback], running: [] })).toBe(true)
      expect((yield* p.run({ flows: [playback], running: [] })).map((e) => e.type)).toEqual(["playback.started"])
      expect((yield* p.run({ flows: [playback], running: [] })).map((e) => e.type)).toEqual(["playback.progress"])
    })))

  it.effect("its actions are the Jellyfin remote, on the activity's session", () =>
    run(Effect.gen(function*() {
      const integration = yield* jellyfin
      yield* integration.actions["playback.playPause"]!(activity({ subjectKey: "playback:s1:i1" }))
      yield* integration.actions["playback.stop"]!(activity({ subjectKey: "playback:s1:i1" }))
      expect(sent).toEqual([["s1", "PlayPause"], ["s1", "Stop"]])
      expect((yield* Effect.flip(integration.actions["playback.stop"]!(activity({})))).message).toBe("Not a playback.")
    })))
})
