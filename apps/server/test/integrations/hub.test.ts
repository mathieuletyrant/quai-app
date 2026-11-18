import { describe, expect, it } from "@effect/vitest"
import { type Duration, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Hub } from "../../src/integrations/Hub.ts"
import { type Integration, Integrations } from "../../src/integrations/Integration.ts"
import { Notifier } from "../../src/push/Notifier.ts"
import { download, engineWith, ev, fixedFlows } from "../flows/helpers.ts"

describe("hub", () => {
  const runs: Array<string> = []
  let needed = true
  const fake = (service: Integration["service"], every: Duration.Input): Integration => ({
    service,
    pollers: [{ name: service, every, needed: () => needed, run: () => Effect.sync(() => (runs.push(service), [])) }],
    actions: {}
  })
  const layer = Layer.effect(Hub, Hub.make).pipe(
    Layer.provideMerge(engineWith([download])),
    Layer.provide([
      fixedFlows([download]),
      Layer.succeed(Notifier, { send: () => Effect.void, sendTo: () => Effect.void }),
      Layer.succeed(Integrations, [fake("qbittorrent", "15 seconds"), fake("quai", "1 minute")])
    ])
  )

  it.effect("runs each poller when due and needed; refresh runs one service at once", () =>
    Effect.gen(function*() {
      const hub = yield* Hub
      yield* hub.beat
      expect(runs).toEqual(["qbittorrent", "quai"])
      yield* TestClock.adjust("15 seconds")
      yield* hub.beat
      expect(runs).toEqual(["qbittorrent", "quai", "qbittorrent"])
      yield* TestClock.adjust("45 seconds")
      yield* hub.beat
      expect(runs.slice(3)).toEqual(["qbittorrent", "quai"])
      yield* hub.refresh("quai")
      expect(runs.at(-1)).toBe("quai")
      needed = false
      yield* TestClock.adjust("1 minute")
      yield* hub.beat
      expect(runs).toHaveLength(6)
    }).pipe(Effect.provide(layer)))

  it.effect("applies webhook events to the engine", () =>
    Effect.gen(function*() {
      yield* (yield* Hub).apply([ev.added()])
    }).pipe(Effect.provide(layer)))
})
