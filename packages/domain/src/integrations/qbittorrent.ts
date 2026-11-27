import { Clock, Effect, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"
import type { Read } from "../home/HomeReads.ts"
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

/** A finished torrent, as Upcoming reads it: what Cleanuparr's download cleaner looks at, and its size. */
const FinishedTorrent = Schema.Struct({
  hash: Schema.String,
  name: Schema.String,
  category: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.String),
  progress: Schema.Number,
  ratio: Schema.Number,
  seeding_time: Schema.Number,
  private: Schema.optional(Schema.NullOr(Schema.Boolean)),
  state: Schema.String,
  /** Bytes of the files it holds (those selected). */
  size: Schema.Number,
  /** Epoch seconds it was added. */
  added_on: Schema.optional(Schema.Number)
})
export type FinishedTorrent = typeof FinishedTorrent.Type

/** Every finished torrent. */
export const finishedTorrentsRead: Read<ReadonlyArray<FinishedTorrent>> = {
  service: "qbittorrent",
  path: "/api/v2/torrents/info?filter=completed",
  schema: Schema.Array(FinishedTorrent)
}

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
  runningWhere(
    context,
    (activity, flow) => activity.downloadId !== null && flow.steps[activity.stepIndex]?.show.progress === true
  )

export const torrentsWatchId = "qbittorrent:torrents"

/** What a download gone from the client says on its Live Activity. */
export const removedDetail = "Removed from the download client"

/**
 * A grab qBittorrent no longer has: replaced by another release, failed, or removed by hand or by
 * Cleanuparr. Only after a minute on the step, the time qBittorrent takes to add what was grabbed.
 */
export const removedDownloads = (
  activities: ReadonlyArray<Activity>,
  torrents: ReadonlyArray<Torrent>,
  now: number
): ReadonlyArray<FlowEvent> => {
  const present = new Set(torrents.map((torrent) => torrent.hash.toLowerCase()))
  const gone = new Set(
    activities
      .filter((activity) =>
        activity.downloadId !== null && !present.has(activity.downloadId) && now - activity.enteredAt >= 60_000
      )
      .map((activity) => activity.downloadId!)
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
      const hashes = [...new Set(downloading(context).map((activity) => activity.downloadId!))].sort()
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
        if (torrents._tag === "None") {
          return yield* Effect.as(Effect.logWarning("qBittorrent: could not read the torrents"), [])
        }
        const now = yield* Clock.currentTimeMillis
        return [...torrents.value.map(progressEvent), ...removedDownloads(downloading(context), torrents.value, now)]
      })
  },
  actions: {}
}
