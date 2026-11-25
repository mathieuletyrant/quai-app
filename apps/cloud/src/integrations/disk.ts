import { diskBackAbovePoints, type DiskSpace } from "@quai/api"
import { Effect, Option } from "effect"
import { type AlertState, alertState } from "../alerts/Alerts.ts"
import type { Read } from "../home/HomeReads.ts"
import { type Integration, readSnapshot, type WatchContext, watchOf } from "./Integration.ts"
import { DiskSpaces, mediaDisk } from "./radarr.ts"

/** `GET /api/v3/diskspace`: Radarr's, else Sonarr's, which see the same disks. */
export const diskReads = {
  radarr: { service: "radarr", path: "/api/v3/diskspace", schema: DiskSpaces },
  sonarr: { service: "sonarr", path: "/api/v3/diskspace", schema: DiskSpaces }
} as const satisfies Record<string, Read<typeof DiskSpaces.Type>>

/** How often Quai Home reads the disk while the alert is on. */
export const diskEverySeconds = 600

export const diskWatchId = "disk:space"

export const freePercent = (disk: DiskSpace) => (disk.freeBytes / disk.totalBytes) * 100

/** "87 GB free (4%)", in decimal units like the iPhone's. */
export const diskDetail = (disk: DiskSpace) => {
  const gigabytes = disk.freeBytes / 1e9
  const free = gigabytes >= 1000 ? `${(gigabytes / 1000).toFixed(1)} TB` : `${Math.round(gigabytes)} GB`
  return `${free} free (${Math.floor(freePercent(disk))}%)`
}

/**
 * The alert's state for one reading: low under the threshold, over once `diskBackAbovePoints`
 * above it, nothing in between, so it doesn't flap around the threshold.
 */
export const diskState = (disk: DiskSpace, belowPercent: number): AlertState | null => {
  const percent = freePercent(disk)
  if (percent < belowPercent) {
    return alertState("diskLow", "disk", [{
      what: "low",
      title: "The media disk is running low",
      detail: diskDetail(disk),
      over: "The media disk has room again"
    }])
  }
  if (percent >= belowPercent + diskBackAbovePoints) return alertState("diskLow", "disk", [])
  return null
}

const readFrom = (context: WatchContext) => {
  if (context.services.includes("radarr")) return diskReads.radarr
  if (context.services.includes("sonarr")) return diskReads.sonarr
  return undefined
}

/** The media disk's free space: Radarr's (or Sonarr's) disk list every 10 minutes, while the Low disk space alert is on. */
export const disk: Integration = {
  service: "quai",
  alertWatcher: {
    watches: (context) => {
      const read = readFrom(context)
      return read === undefined || !context.alerts.diskLow.enabled ? [] : [watchOf(diskWatchId, read, diskEverySeconds)]
    },
    read: (snapshot, context) =>
      Effect.map(
        readSnapshot(snapshot.watch.service === "sonarr" ? diskReads.sonarr : diskReads.radarr, snapshot),
        (disks) => {
          const media = Option.flatMap(disks, (list) => Option.fromNullishOr(mediaDisk(list)))
          if (Option.isNone(media)) return []
          const state = diskState(media.value, context.alerts.diskLow.belowPercent)
          return state === null ? [] : [state]
        }
      )
  },
  actions: {}
}
