import {
  type AlertSettings,
  HomeOffline,
  type Storage as StorageAnswer,
  type StorageDisk,
  type StoragePeriod
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { Alerts } from "../alerts/Alerts.ts"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { HomeTime } from "../home/HomeTime.ts"
import { DiskReadings, marksDisk, periodStart, resolution, shownMark, type StoredMark } from "./DiskReadings.ts"
import { freeShare, type MediaDisk, readMediaDisks } from "./MediaDisks.ts"

/** A disk as the Storage screen shows it: now, the period's readings and marks. */
interface DiskNow extends MediaDisk {
  /** Read now; else its last reading stands in. */
  readonly current: boolean
}

/** Under the disk low alert's threshold, the alert on. */
export const isLow = (disk: MediaDisk, alerts: Pick<AlertSettings, "diskLow">) =>
  alerts.diskLow.enabled && freeShare(disk) * 100 < alerts.diskLow.belowPercent

/** One disk over the period: its readings at the period's resolution, its marks newest first. */
export const storageDisk = (
  disk: MediaDisk,
  input: {
    readonly readings: StorageDisk["readings"]
    readonly marks: ReadonlyArray<StoredMark>
    readonly from: number
    readonly low: boolean
  }
): StorageDisk => {
  const own = input.marks.filter((mark) => marksDisk(mark, disk))
  return {
    id: disk.id,
    name: disk.name,
    holds: disk.holds,
    freeBytes: disk.freeBytes,
    totalBytes: disk.totalBytes,
    low: input.low,
    readings: input.readings,
    marks: own.filter((mark) => mark.at >= input.from).map(shownMark),
    allMarks: own.length
  }
}

/**
 * The Storage screen (GLOSSARY: disk readings): the media disks now, read through Quai Home, with
 * their kept readings and marks. A disk its service didn't answer for shows its last reading.
 */
export class Storage extends Context.Service<Storage, {
  readonly read: (period: StoragePeriod) => Effect.Effect<StorageAnswer, HomeOffline>
}>()("quai/Storage") {
  static readonly layer = Layer.effect(
    Storage,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const link = yield* HomeLink
      const kept = yield* DiskReadings
      const alerts = yield* Alerts
      const time = yield* HomeTime

      /** The disks read now, then those kept that weren't, at their last reading. */
      const disksNow = (now: ReadonlyArray<MediaDisk>) =>
        Effect.gen(function*() {
          const seen = new Set(now.map((disk) => disk.id))
          const missing = (yield* kept.disks).filter((disk) => !seen.has(disk.id))
          const last = yield* Effect.forEach(missing, (disk) =>
            Effect.map(kept.readings(disk.id, Number.NEGATIVE_INFINITY), (readings) => {
              const reading = readings.at(-1)
              return reading === undefined ? [] : [{ ...disk, freeBytes: reading.freeBytes, current: false }]
            }))
          return [...now.map((disk): DiskNow => ({ ...disk, current: true })), ...last.flat()]
        })

      const read = (period: StoragePeriod) =>
        Effect.gen(function*() {
          const home = yield* link.home
          if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
          const { disks: read, unavailable } = yield* readMediaDisks(reads, home.value)
          const now = yield* Clock.currentTimeMillis
          const from = periodStart(period, now)
          const settings = yield* alerts.settings
          const timeZone = yield* time.zone
          const marks = yield* kept.marks
          const disks = yield* disksNow(read)
          const shown = yield* Effect.forEach(disks, (disk) =>
            Effect.map(kept.readings(disk.id, from), (readings) =>
              storageDisk(disk, {
                readings: resolution(readings, period, timeZone),
                marks,
                from,
                low: disk.current && isLow(disk, settings)
              })))
          return {
            period,
            disks: [...shown].sort((left, right) =>
              freeShare(left) - freeShare(right)
            ),
            unavailable
          }
        })

      return { read }
    })
  )
}
