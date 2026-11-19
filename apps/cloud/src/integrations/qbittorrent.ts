import { Effect, Schema } from "effect"
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

/**
 * qBittorrent doesn't push: Quai Home reads the progress of the torrents every 15 s, only while a
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
        everySeconds: 15
      }]
    },
    read: ({ status, body }) => {
      if (status !== 200) return Effect.as(Effect.logWarning(`qBittorrent answered HTTP ${status}`), [])
      const torrents = readJson(Torrents, body)
      return torrents._tag === "None"
        ? Effect.as(Effect.logWarning("qBittorrent: could not read the torrents"), [])
        : Effect.succeed(torrents.value.map(progressEvent))
    }
  },
  actions: {}
}
