import { testLink } from "../fakeHome.ts"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Activities } from "../../src/flows/Activities.ts"
import { ActionRunner } from "../../src/flows/ActionRunner.ts"
import { HomeLink } from "../../src/home/HomeLink.ts"
import { Hub } from "../../src/integrations/Hub.ts"
import { Journal } from "../../src/journal/Journal.ts"
import { type Integration, Integrations } from "../../src/integrations/Integration.ts"
import { download, engineWith, ev, fixedFlows, playback } from "./helpers.ts"

describe("Live Activity buttons", () => {
  const ran: Array<string> = []
  const refreshed: Array<string> = []
  const jellyfin: Integration = {
    service: "jellyfin",
    actions: { "playback.playPause": (a) => Effect.sync(() => void ran.push(`playPause ${a.subjectKey}`)) }
  }
  const layer = ActionRunner.layer.pipe(
    Layer.provideMerge(engineWith([download, playback])),
    Layer.provide([
      fixedFlows([download, playback]),
      Layer.succeed(Integrations, [jellyfin]),
      Journal.layer.pipe(Layer.provide(testLink)),
      Layer.succeed(Hub, {
        apply: () => Effect.void,
        beat: Effect.void,
        sync: Effect.void,
        handle: () => Effect.void,
        refresh: (s) => Effect.sync(() => void refreshed.push(s))
      })
    ])
  )
  const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }

  it.effect("goes to the integration of the action's service, then refreshes that service", () =>
    Effect.gen(function*() {
      yield* (yield* Activities).handle({ type: "playback.started", subject: tv })
      yield* (yield* ActionRunner).run("playback|playback:s1:i1", "playback.playPause")
      expect(ran).toEqual(["playPause playback:s1:i1"])
      expect(refreshed).toEqual(["jellyfin"])
    }).pipe(Effect.provide(layer)))

  it.effect("refuses a button the step doesn't offer, one no integration runs, and unknown activities", () =>
    Effect.gen(function*() {
      const engine = yield* Activities
      yield* engine.handle(ev.added())
      yield* engine.handle({ type: "playback.started", subject: tv })
      const runner = yield* ActionRunner
      expect((yield* Effect.flip(runner.run("download|movie:tmdb:1", "playback.stop")))._tag).toBe("InvalidAction")
      expect((yield* Effect.flip(runner.run("playback|playback:s1:i1", "playback.stop")))._tag).toBe("InvalidAction")
      expect((yield* Effect.flip(runner.run("nope", "playback.stop")))._tag).toBe("NotFound")
    }).pipe(Effect.provide(layer)))
})
