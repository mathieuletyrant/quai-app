import { diskBackAbovePoints, type DiskSpace, HomeProtocol, type LibraryService } from "@quai/api"
import { Effect, Option } from "effect"
import { type AlertState, alertState } from "../alerts/Alerts.ts"
import { DiskReadings } from "../storage/DiskReadings.ts"
import { diskReads, type DiskView, freeShare, type MediaDisk, mediaDisks, readsRoots } from "../storage/MediaDisks.ts"
import { type Integration, readSnapshot, type Snapshot, type WatchContext, watchOf } from "./Integration.ts"

/** How often Quai Home reads the disks while the alert is on. */
export const diskEverySeconds = 600

/** How often otherwise: the disk readings are hourly. */
export const readingEverySeconds = 3600

const services = ["radarr", "sonarr"] as const satisfies ReadonlyArray<LibraryService>

export const mountsWatchId = (service: LibraryService) => `disk:${service}:space`
export const rootsWatchId = (service: LibraryService) => `disk:${service}:roots`

export const freePercent = (disk: DiskSpace) => freeShare(disk) * 100

/** "87 GB free (4%)", in decimal units like the iPhone's. */
export const diskDetail = (disk: DiskSpace) => {
  const gigabytes = disk.freeBytes / 1e9
  const free = gigabytes >= 1000 ? `${(gigabytes / 1000).toFixed(1)} TB` : `${Math.round(gigabytes)} GB`
  return `${free} free (${Math.floor(freePercent(disk))}%)`
}

/**
 * The disk low alert's scope and words for one disk. A home with one media disk keeps the scope
 * the alert always had (`disk`), so an alert going on stays the same one; with several, each disk
 * is its own, named by what it holds.
 */
const alertOf = (disk: MediaDisk, alone: boolean) =>
  alone
    ? { scope: "disk", title: "The media disk is running low", over: "The media disk has room again" }
    : {
      scope: `disk:${disk.id}`,
      title: `The ${disk.name} disk is running low`,
      over: `The ${disk.name} disk has room again`
    }

/**
 * The alert's state for one disk's reading: low under the threshold, over once `diskBackAbovePoints`
 * above it, nothing in between, so it doesn't flap around the threshold.
 */
export const diskState = (disk: MediaDisk, belowPercent: number, alone = true): AlertState | null => {
  const percent = freePercent(disk)
  const { over, scope, title } = alertOf(disk, alone)
  if (percent < belowPercent) {
    return alertState("diskLow", scope, [{ what: "low", title, detail: diskDetail(disk), over }])
  }
  if (percent >= belowPercent + diskBackAbovePoints) return alertState("diskLow", scope, [])
  return null
}

/** The alert's states for the disks read now. */
export const diskStates = (disks: ReadonlyArray<MediaDisk>, belowPercent: number) =>
  disks.flatMap((disk) => {
    const state = diskState(disk, belowPercent, disks.length === 1)
    return state === null ? [] : [state]
  })

/** The watches for one service: its disks, faster while the alert is on, and its root folders. */
const watchesOf = (service: LibraryService, context: WatchContext): ReadonlyArray<HomeProtocol.Watch> => {
  const every = context.alerts.diskLow.enabled ? diskEverySeconds : readingEverySeconds
  const reads = diskReads[service]
  const mounts = watchOf(mountsWatchId(service), reads.mounts, every)
  return readsRoots({ protocol: context.protocol ?? HomeProtocol.protocolVersion })
    ? [mounts, watchOf(rootsWatchId(service), reads.roots, readingEverySeconds)]
    : [mounts]
}

/**
 * The media disks: Radarr's and Sonarr's disk lists and root folders, read every hour (every 10
 * minutes while the disk low alert is on). Each reading is kept (`DiskReadings`) and, with the
 * alert on, says whether a disk runs low.
 */
export const disk = Effect.gen(function*() {
  const readings = yield* DiskReadings
  /** The last answer to each watch: a reading of one service completes the other's. */
  const mounts = new Map<LibraryService, DiskView["mounts"]>()
  const roots = new Map<LibraryService, NonNullable<DiskView["roots"]>>()

  const views = (context: WatchContext): ReadonlyArray<DiskView> =>
    services.flatMap((service) => {
      const seen = mounts.get(service)
      if (seen === undefined || !context.services.includes(service)) return []
      const folders = roots.get(service)
      return [{ service, mounts: seen, ...(folders === undefined ? {} : { roots: folders }) }]
    })

  /** Keeps what the snapshot says; false when it isn't one of the disk watches or can't be read. */
  const remember = (snapshot: Snapshot) =>
    Effect.gen(function*() {
      for (const service of services) {
        if (snapshot.watch.id === mountsWatchId(service)) {
          const value = yield* readSnapshot(diskReads[service].mounts, snapshot)
          if (Option.isSome(value)) mounts.set(service, value.value)
          return Option.isSome(value)
        }
        if (snapshot.watch.id === rootsWatchId(service)) {
          const value = yield* readSnapshot(diskReads[service].roots, snapshot)
          if (Option.isSome(value)) roots.set(service, value.value)
          return Option.isSome(value)
        }
      }
      return false
    })

  const integration: Integration = {
    service: "quai",
    alertWatcher: {
      watches: (context) =>
        services.filter((service) => context.services.includes(service)).flatMap((service) =>
          watchesOf(service, context)
        ),
      read: (snapshot, context) =>
        Effect.gen(function*() {
          if (!(yield* remember(snapshot))) return []
          const disks = mediaDisks(views(context))
          yield* readings.record(disks)
          return context.alerts.diskLow.enabled ? diskStates(disks, context.alerts.diskLow.belowPercent) : []
        })
    },
    actions: {}
  }
  return integration
})
