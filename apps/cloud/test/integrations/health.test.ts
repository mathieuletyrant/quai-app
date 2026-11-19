import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { downAfterMs, health, makeHealthState } from "../../src/integrations/health.ts"
import type { WatchContext } from "../../src/integrations/Integration.ts"
import { download, incident } from "../flows/helpers.ts"

const context = (flows = [incident]): WatchContext => ({ flows, running: [], services: ["radarr", "qbittorrent"] })

describe("health", () => {
  it.effect("one watch per service Quai Home reaches, on its status endpoint, while a service flow is on", () =>
    Effect.gen(function*() {
      const watcher = (yield* health).watcher!
      expect(watcher.watches(context())).toEqual([
        { id: "health:radarr", service: "radarr", path: "/api/v3/system/status", everySeconds: 60 },
        { id: "health:qbittorrent", service: "qbittorrent", path: "/api/v2/app/version", everySeconds: 60 }
      ])
      expect(watcher.watches(context([download]))).toEqual([])
    }))

  it("down only after 5 min of failures, once; back on the first answer", () => {
    const state = makeHealthState()
    expect(state.observe("radarr", true, 0)).toEqual([])
    expect(state.observe("radarr", false, 0)).toEqual([])
    expect(state.due(downAfterMs - 1)).toEqual([])
    const [down] = state.due(downAfterMs)
    expect([down?.type, down?.subject?.key, down?.values?.since]).toEqual(["service.down", "service:radarr", 0])
    expect(state.due(downAfterMs + 60_000)).toEqual([])
    expect(state.observe("radarr", false, downAfterMs + 60_000)).toEqual([])
    expect(state.observe("radarr", true, downAfterMs + 120_000).map((e) => e.type)).toEqual(["service.up"])
    expect(state.observe("radarr", true, downAfterMs + 180_000)).toEqual([])
  })

  it.effect("a 5xx snapshot or a failed watch counts as down; the heartbeat reports it after 5 min", () =>
    Effect.gen(function*() {
      const watcher = (yield* health).watcher!
      const [radarr, qbittorrent] = watcher.watches(context())
      // qBittorrent's 403 without a session still proves it's up.
      expect(yield* watcher.read({ watch: qbittorrent!, status: 403, body: "Forbidden" }, context())).toEqual([])
      expect(yield* watcher.read({ watch: radarr!, status: 503, body: "" }, context())).toEqual([])
      expect(yield* watcher.failed!(qbittorrent!, "unreachable", context())).toEqual([])
      yield* TestClock.adjust("4 minutes")
      expect(yield* watcher.tick!(context())).toEqual([])
      yield* TestClock.adjust("1 minute")
      expect((yield* watcher.tick!(context())).map((e) => e.subject?.key)).toEqual(["service:radarr", "service:qbittorrent"])
      expect(yield* watcher.tick!(context())).toEqual([])
      expect((yield* watcher.read({ watch: radarr!, status: 200, body: "{}" }, context())).map((e) => e.type)).toEqual(["service.up"])
    }))
})
