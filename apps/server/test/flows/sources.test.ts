import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { playbackEvents } from "../../src/flows/Playback.ts"
import { Health } from "../../src/stack/Health.ts"
import { playingFrom } from "../../src/stack/Jellyfin.ts"
import { StackConfig } from "../../src/stack/StackConfig.ts"
import { fakeHttp } from "../fakeHttp.ts"

describe("Jellyfin playback", () => {
  const sessions = [{
    Id: "s1",
    DeviceName: "TV Salon",
    NowPlayingItem: { Id: "i1", Name: "Who Is Alive?", SeriesName: "Severance", ParentIndexNumber: 2, IndexNumber: 3, RunTimeTicks: 36_000_000_000 },
    PlayState: { PositionTicks: 12_000_000_000, IsPaused: false }
  }, { Id: "idle", DeviceName: "iPad" }]

  it("reads what plays, with the time left", () => {
    expect(playingFrom(sessions)).toEqual([{
      key: "playback:s1:i1",
      title: "Severance · S02E03",
      device: "TV Salon",
      paused: false,
      remainingMs: 2_400_000
    }])
  })

  it("started, then position, then stopped", () => {
    const now = playingFrom(sessions)
    const first = playbackEvents(new Map(), now, 1_000)
    expect(first.map((e) => e.type)).toEqual(["playback.started"])
    expect(first[0]!.values).toEqual({ detail: "TV Salon", endsAt: 2_401_000 })
    const before = new Map(now.map((p) => [p.key, p]))
    expect(playbackEvents(before, now, 2_000).map((e) => e.type)).toEqual(["playback.progress"])
    expect(playbackEvents(before, [], 3_000).map((e) => e.type)).toEqual(["playback.stopped"])
  })
})

describe("health checks", () => {
  let radarrUp = true
  const http = fakeHttp((r) => (r.url.host === "radarr:7878" && !radarrUp ? { status: 503 } : { json: {} }))
  const config = Layer.succeed(StackConfig, {
    radarr: { url: "http://radarr:7878", apiKey: Redacted.make("k") },
    sonarr: null,
    qbittorrent: null,
    jellyfin: null,
    internalUrl: null
  })

  it.effect("down only after 5 min of failures, once; back on the first answer", () =>
    Effect.gen(function*() {
      const health = yield* Health
      expect(yield* health.check).toEqual([])
      radarrUp = false
      expect(yield* health.check).toEqual([])
      yield* TestClock.adjust("4 minutes")
      expect(yield* health.check).toEqual([])
      yield* TestClock.adjust("1 minute")
      const down = yield* health.check
      expect(down.map((e) => [e.type, e.subject?.key])).toEqual([["service.down", "service:radarr"]])
      yield* TestClock.adjust("1 minute")
      expect(yield* health.check).toEqual([])
      radarrUp = true
      expect((yield* health.check).map((e) => e.type)).toEqual(["service.up"])
      expect(yield* health.check).toEqual([])
    }).pipe(Effect.provide(Health.layer.pipe(Layer.provide([config, http])))))
})
