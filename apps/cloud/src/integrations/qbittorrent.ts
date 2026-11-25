import { Clock, Effect, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { type Integration, readJson, runningWhere, type WatchContext } from "./Integration.ts"

const Torrent = Schema.Struct({
  hash: Schema.String,
  progress: Schema.Number,
  dlspeed: Schema.Number,
  eta: Schema.Number,
  state: Schema.String
})
export const Torrents = Schema.Array(Torrent)
export type Torrent = typeof Torrent.Type

/** qBittorrent's "unknown" ETA (100 days). */
const infiniteEta = 8_640_000

export const progressEvent = (torrent: Torrent): FlowEvent => ({
  type: "download.progress",
  downloadId: torrent.hash.toLowerCase(),
  values: {
    progress: torrent.progress,
    bytesPerSecond: torrent.dlspeed,
    ...(torrent.eta >= infiniteEta || torrent.eta < 0 ? {} : { remainingSeconds: torrent.eta })
  }
})

/** Running activities on a torrent whose current step shows progress. */
const downloading = (context: WatchContext): ReadonlyArray<Activity> =>
  runningWhere(context, (a, flow) => a.downloadId !== null && flow.steps[a.stepIndex]?.show.progress === true)

export const torrentsWatchId = "qbittorrent:torrents"

/** What a download gone from the client says on its Live Activity. */
export const removedDetail = "Removed from the download client"

/**
 * A grab qBittorrent no longer has: replaced by another release, failed, or removed by hand or by
 * Cleanuparr. Only after a minute on the step, the time qBittorrent takes to add what was grabbed.
 */
export const removedDownloads = (activities: ReadonlyArray<Activity>, torrents: ReadonlyArray<Torrent>, now: number): ReadonlyArray<FlowEvent> => {
  const present = new Set(torrents.map((t) => t.hash.toLowerCase()))
  const gone = new Set(
    activities
      .filter((a) => a.downloadId !== null && !present.has(a.downloadId) && now - a.enteredAt >= 60_000)
      .map((a) => a.downloadId!)
  )
  return [...gone].map((downloadId) => ({ type: "download.removed", downloadId, values: { detail: removedDetail } }))
}

/**
 * qBittorrent doesn't push: Quai Home reads the progress of the torrents every 5 s (the Home protocol's minimum), only while a
 * running activity's current step shows it. (Quai Home logs in to qBittorrent itself.)
 */
export const qbittorrent: Integration = {
  service: "qbittorrent",
  watcher: {
    watches: (context) => {
      const hashes = [...new Set(downloading(context).map((a) => a.downloadId!))].sort()
      return hashes.length === 0 ? [] : [{
        id: torrentsWatchId,
        service: "qbittorrent",
        path: `/api/v2/torrents/info?hashes=${encodeURIComponent(hashes.join("|"))}`,
        everySeconds: 5
      }]
    },
    read: ({ status, body }, context) =>
      Effect.gen(function*() {
        if (status !== 200) return yield* Effect.as(Effect.logWarning(`qBittorrent answered HTTP ${status}`), [])
        const torrents = readJson(Torrents, body)
        if (torrents._tag === "None") return yield* Effect.as(Effect.logWarning("qBittorrent: could not read the torrents"), [])
        const now = yield* Clock.currentTimeMillis
        return [...torrents.value.map(progressEvent), ...removedDownloads(downloading(context), torrents.value, now)]
      })
  },
  actions: {}
}
