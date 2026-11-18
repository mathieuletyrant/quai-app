import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Activities } from "../../src/flows/Activities.ts"
import { ActionRunner } from "../../src/flows/ActionRunner.ts"
import { sessionOf } from "../../src/flows/Playback.ts"
import { Watcher } from "../../src/flows/Watcher.ts"
import type { PlaybackCommand } from "../../src/stack/Jellyfin.ts"
import { Jellyfin } from "../../src/stack/Jellyfin.ts"
import { download, engineWith, ev, fixedFlows, playback } from "./helpers.ts"

describe("Live Activity buttons", () => {
  const sent: Array<[string, PlaybackCommand]> = []
  let refreshed = 0
  const jellyfin = Layer.succeed(Jellyfin, {
    configured: true,
    find: () => Effect.succeed(null),
    playing: Effect.succeed([]),
    command: (session, command) => Effect.sync(() => void sent.push([session, command]))
  })
  const watcher = Layer.succeed(Watcher, {
    handle: () => Effect.void,
    poll: Effect.void,
    checkHealth: Effect.void,
    pollPlayback: Effect.sync(() => void refreshed++)
  })
  const layer = ActionRunner.layer.pipe(
    Layer.provideMerge(engineWith([download, playback])),
    Layer.provide([jellyfin, watcher, fixedFlows([download, playback])])
  )
  const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }

  it.effect("Play/Pause reaches the right Jellyfin session, then refreshes at once", () =>
    Effect.gen(function*() {
      yield* (yield* Activities).handle({ type: "playback.started", subject: tv })
      yield* (yield* ActionRunner).run("playback|playback:s1:i1", "playback.playPause")
      expect(sent).toEqual([["s1", "PlayPause"]])
      expect(refreshed).toBe(1)
    }).pipe(Effect.provide(layer)))

  it.effect("refuses a button the step doesn't offer, and unknown activities", () =>
    Effect.gen(function*() {
      yield* (yield* Activities).handle(ev.added())
      const runner = yield* ActionRunner
      expect((yield* Effect.flip(runner.run("download|movie:tmdb:1", "playback.stop")))._tag).toBe("InvalidAction")
      expect((yield* Effect.flip(runner.run("nope", "playback.stop")))._tag).toBe("NotFound")
    }).pipe(Effect.provide(layer)))

  it("reads the session from a playback subject", () => {
    expect(sessionOf("playback:abc:item")).toBe("abc")
    expect(sessionOf("movie:tmdb:1")).toBeNull()
  })
})
