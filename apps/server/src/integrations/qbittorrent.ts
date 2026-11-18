import { Effect } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { QBittorrent, type Torrent } from "../stack/QBittorrent.ts"
import { type Integration, type PollContext, runningWhere } from "./Integration.ts"

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
const downloading = (context: PollContext): ReadonlyArray<Activity> =>
  runningWhere(context, (a, flow) => a.downloadId !== null && flow.steps[a.stepIndex]?.show.progress === true)

/**
 * qBittorrent doesn't push: its progress is read every 15 s, only while a running activity's
 * current step shows it.
 */
export const qbittorrent = Effect.gen(function*() {
  const client = yield* QBittorrent
  const integration: Integration = {
    service: "qbittorrent",
    pollers: [{
      name: "download progress",
      every: "15 seconds",
      needed: (context) => downloading(context).length > 0,
      run: (context) =>
        client.torrents([...new Set(downloading(context).map((a) => a.downloadId!))]).pipe(
          Effect.map((torrents) => torrents.map(progressEvent)),
          Effect.catchTag("StackError", (e) => Effect.as(Effect.logWarning(`qBittorrent: ${e.message}`), []))
        )
    }],
    actions: {}
  }
  return integration
})
