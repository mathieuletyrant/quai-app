import { defaultAlertSettings } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import type { Activity } from "../../src/flows/Engine.ts"
import type { WatchContext } from "../../src/integrations/Integration.ts"
import { qbittorrent, removedDetail, removedDownloads, Torrents, torrentsWatchId } from "../../src/integrations/qbittorrent.ts"
import { Effect, Schema } from "effect"
import { TestClock } from "effect/testing"
import { fixture } from "../fixtures.ts"
import { download } from "../flows/helpers.ts"

const activity = (stepIndex: number, downloadId: string | null): Activity => ({
  key: `download|${downloadId}`,
  flowId: "download",
  subjectKey: `movie:${downloadId}`,
  title: "Dune",
  stepIndex,
  tone: "active",
  values: {},
  downloadId,
  lookup: null,
  enteredAt: 0,
  movedAt: 0,
  lastEventAt: 0,
  endedAt: null,
  pushedAt: 0,
  pushedFingerprint: null
})

const ctx = (running: ReadonlyArray<Activity>): WatchContext => ({ flows: [download], running, services: ["qbittorrent"], now: 0, timeZone: "UTC", alerts: defaultAlertSettings })

describe("qBittorrent", () => {
  const watcher = qbittorrent.watcher!

  it("watches the torrents of the activities whose step shows progress, in one stable watch", () => {
    expect(watcher.watches(ctx([activity(0, null), activity(2, "c")]))).toEqual([])
    expect(watcher.watches(ctx([activity(1, "b"), activity(1, "a"), activity(1, "a")]))).toEqual([{
      id: torrentsWatchId,
      service: "qbittorrent",
      path: "/api/v2/torrents/info?hashes=a%7Cb",
      everySeconds: 5
    }])
  })

  it.effect("reads progress, speed and ETA from the torrents; an unknown ETA is left out", () =>
    Effect.gen(function*() {
      const [watch] = watcher.watches(ctx([activity(1, "a")]))
      const events = yield* watcher.read({ watch: watch!, status: 200, body: JSON.stringify(fixture("qbittorrent/torrents-info.json")) }, ctx([]))
      expect(events).toEqual([
        { type: "download.progress", downloadId: "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e", values: { progress: 0.4199, bytesPerSecond: 8388608, remainingSeconds: 683 } },
        { type: "download.progress", downloadId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", values: { progress: 0, bytesPerSecond: 0 } }
      ])
      expect(yield* watcher.read({ watch: watch!, status: 403, body: "Forbidden" }, ctx([]))).toEqual([])
      expect(yield* watcher.read({ watch: watch!, status: 200, body: "not json" }, ctx([]))).toEqual([])
    }))

  // Rings of Power S03E07: Sonarr grabbed one release, marked it failed and grabbed another. The
  // first one left qBittorrent; its activity must not wait at 0 % forever.
  it("a grab qBittorrent no longer has is removed, once the client had a minute to add it", () => {
    const torrents = Schema.decodeUnknownSync(Torrents)(fixture("real/qbittorrent/torrents-info.json"))
    const kept = torrents[0]!.hash.toLowerCase()
    const running = [{ ...activity(1, kept), enteredAt: 0 }, { ...activity(1, "gone"), enteredAt: 0 }, { ...activity(1, "gone"), key: "other|gone", enteredAt: 0 }]
    expect(removedDownloads(running, torrents, 59_999)).toEqual([])
    expect(removedDownloads(running, torrents, 60_000)).toEqual([
      { type: "download.removed", downloadId: "gone", values: { detail: removedDetail } }
    ])
  })

  it.effect("the read reports the removed grabs with the progress of the others", () =>
    Effect.gen(function*() {
      const running = [activity(1, "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"), activity(1, "deadbeef")]
      yield* TestClock.adjust("1 minute")
      const [watch] = watcher.watches(ctx(running))
      const events = yield* watcher.read({ watch: watch!, status: 200, body: JSON.stringify(fixture("qbittorrent/torrents-info.json")) }, ctx(running))
      expect(events.map((event) => [event.type, event.downloadId])).toEqual([
        ["download.progress", "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e"],
        ["download.progress", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"],
        ["download.removed", "deadbeef"]
      ])
      // An answer qBittorrent couldn't give removes nothing.
      expect(yield* watcher.read({ watch: watch!, status: 403, body: "Forbidden" }, ctx(running))).toEqual([])
    }))
})
