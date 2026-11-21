import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Activities } from "../../src/flows/Activities.ts"
import { FlowStore } from "../../src/flows/FlowStore.ts"
import { HomeReads } from "../../src/home/HomeReads.ts"
import { Hub } from "../../src/integrations/Hub.ts"
import { type Integration, Integrations } from "../../src/integrations/Integration.ts"
import { qbittorrent } from "../../src/integrations/qbittorrent.ts"
import { radarr } from "../../src/integrations/radarr.ts"
import { Apns } from "../../src/push/Apns.ts"
import { cloud, makeFakeHome, settle } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"

const hash = "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"

/** Fails and ticks recorded, from a watch that is always on. */
const failures: Array<string> = []
const ticks: Array<number> = []
const probe: Integration = {
  service: "quai",
  watcher: {
    watches: () => [{ id: "probe", service: "radarr", path: "/api/v3/system/status", everySeconds: 60 }],
    read: () => Effect.succeed([]),
    failed: (watch, reason) => Effect.sync(() => (failures.push(`${watch.id}: ${reason}`), [])),
    tick: () => Effect.sync(() => (ticks.push(ticks.length), []))
  },
  actions: {}
}

const layer = (integrations: ReadonlyArray<Integration | Effect.Effect<Integration, never, HomeReads>>) =>
  cloud(Layer.effect(Integrations, Effect.all(integrations.map((i) => Effect.isEffect(i) ? i : Effect.succeed(i)))))
    .pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))

const setWatches = (home: { readonly received: ReadonlyArray<{ readonly _tag: string }> }) =>
  home.received.filter((m) => m._tag === "SetWatches").length

describe("hub", () => {
  it.effect("sends the watches the running activities need when they change, and only then", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      expect(home.state.watches).toEqual([])
      expect(setWatches(home)).toBe(1)

      yield* home.webhook("radarr", fixture("radarr/grab.json"))
      expect(home.state.watches.map((w) => [w.id, w.path])).toEqual([["qbittorrent:torrents", `/api/v2/torrents/info?hashes=${hash}`]])
      expect(setWatches(home)).toBe(2)

      yield* home.snapshot("qbittorrent:torrents", (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
      const [activity] = (yield* (yield* Activities).snapshot).activities.values()
      expect(activity?.values.progress).toBe(0.4199)
      // Same watches after the snapshot and after a heartbeat: nothing sent again.
      yield* (yield* Hub).beat
      expect(setWatches(home)).toBe(2)

      // A refresh (after an action) sends them again, so Quai Home reads them now.
      yield* (yield* Hub).refresh("qbittorrent")
      yield* settle
      expect(setWatches(home)).toBe(3)

      // Imported: nothing shows progress anymore.
      yield* home.webhook("radarr", fixture("radarr/download.json"))
      expect(home.state.watches).toEqual([])
      expect(setWatches(home)).toBe(4)
    }).pipe(Effect.provide(layer([radarr, qbittorrent]))))

  it.effect("follows flow edits, sends the watches again to a home that reconnects, and only those it reaches", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["qbittorrent"] })
      yield* home.connect
      yield* home.webhook("radarr", fixture("radarr/grab.json"))
      // The probe watches Radarr, which this Quai Home doesn't reach.
      expect(home.state.watches.map((w) => w.id)).toEqual(["qbittorrent:torrents"])

      // Reconnected, Quai Home starts with no watch: they're sent again.
      yield* home.disconnect
      expect(home.state.watches).toEqual([])
      yield* home.connect
      expect(home.state.watches.map((w) => w.id)).toEqual(["qbittorrent:torrents"])

      // A flow whose downloading step no longer shows progress: no torrent watch.
      const store = yield* FlowStore
      const download = (yield* store.all).find((f) => f.id === "download")!
      yield* store.save({ ...download, steps: download.steps.map((s) => ({ ...s, show: {} })) })
      yield* (yield* Hub).sync
      expect(home.state.watches).toEqual([])
    }).pipe(Effect.provide(layer([radarr, qbittorrent, probe]))))

  it.effect("a failed watch goes to its integration; the heartbeat ticks only while a home is connected", () =>
    Effect.gen(function*() {
      const hub = yield* Hub
      yield* hub.beat
      expect(ticks).toEqual([])
      const home = yield* makeFakeHome()
      yield* home.connect
      yield* home.failWatch("probe", "unreachable")
      yield* home.failWatch("unknown", "not allowed")
      expect(failures).toEqual(["probe: unreachable"])
      yield* hub.beat
      expect(ticks).toEqual([0])
      yield* home.disconnect
      yield* hub.beat
      expect(ticks).toEqual([0])
    }).pipe(Effect.provide(layer([probe]))))
})
