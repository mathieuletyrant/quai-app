import { defaultAlertSettings } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { health, makeHealthState } from "../../src/integrations/health.ts"
import type { WatchContext } from "../../src/integrations/Integration.ts"

const context = (alerts = defaultAlertSettings): WatchContext => ({ flows: [], running: [], services: ["radarr", "qbittorrent"], now: 0, timeZone: "UTC", alerts })
const fiveMinutes = 5 * 60_000
const off = { ...defaultAlertSettings, serviceDown: { enabled: false, afterMinutes: 5 } }
const raised = (states: ReadonlyArray<{ readonly scope: string; readonly raised: ReadonlyArray<unknown> }>) =>
  states.map((state) => `${state.scope}:${state.raised.length === 0 ? "up" : "down"}`)

describe("health", () => {
  it.effect("one watch per service Quai Home reaches, on its status endpoint, while the Service down alert is on", () =>
    Effect.gen(function*() {
      const watcher = (yield* health).alertWatcher!
      expect(watcher.watches(context())).toEqual([
        { id: "health:radarr", service: "radarr", path: "/api/v3/system/status", everySeconds: 60 },
        { id: "health:qbittorrent", service: "qbittorrent", path: "/api/v2/app/version", everySeconds: 60 }
      ])
      expect(watcher.watches(context(off))).toEqual([])
    }))

  it("up on the first answer (an alert left from before a restart ends), down after the setting's minutes, once; up again on the next answer", () => {
    const state = makeHealthState()
    expect(raised(state.observe("radarr", true, 0, fiveMinutes))).toEqual(["radarr:up"])
    expect(state.observe("radarr", true, 1, fiveMinutes)).toEqual([])
    expect(state.observe("radarr", false, 0, fiveMinutes)).toEqual([])
    expect(state.due(fiveMinutes - 1, fiveMinutes)).toEqual([])
    const [down] = state.due(fiveMinutes, fiveMinutes)
    expect(down?.raised.map((r) => [r.title, r.detail])).toEqual([["Radarr isn't answering", "No answer for 5 minutes"]])
    expect(state.due(fiveMinutes + 60_000, fiveMinutes)).toEqual([])
    expect(raised(state.observe("radarr", true, fiveMinutes + 120_000, fiveMinutes))).toEqual(["radarr:up"])
    expect(state.observe("radarr", true, fiveMinutes + 180_000, fiveMinutes)).toEqual([])
  })

  it.effect("a 5xx snapshot or a failed watch counts as down; the heartbeat reports it after the setting's minutes", () =>
    Effect.gen(function*() {
      const watcher = (yield* health).alertWatcher!
      const ten = context({ ...defaultAlertSettings, serviceDown: { enabled: true, afterMinutes: 10 } })
      const [radarr, qbittorrent] = watcher.watches(ten)
      // qBittorrent's 403 without a session still proves it's up.
      expect(raised(yield* watcher.read({ watch: qbittorrent!, status: 403, body: "Forbidden" }, ten))).toEqual(["qbittorrent:up"])
      expect(yield* watcher.read({ watch: radarr!, status: 503, body: "" }, ten)).toEqual([])
      expect(yield* watcher.failed!(qbittorrent!, "unreachable", ten)).toEqual([])
      yield* TestClock.adjust("9 minutes")
      expect(yield* watcher.tick!(ten)).toEqual([])
      yield* TestClock.adjust("1 minute")
      expect(raised(yield* watcher.tick!(ten))).toEqual(["radarr:down", "qbittorrent:down"])
      expect(yield* watcher.tick!(ten)).toEqual([])
      expect(raised(yield* watcher.read({ watch: radarr!, status: 200, body: "{}" }, ten))).toEqual(["radarr:up"])
    }))
})
