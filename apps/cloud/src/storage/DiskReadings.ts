import {
  type DiskHolds,
  DiskHolds as DiskHoldsSchema,
  type DiskMark,
  DiskMarkKind,
  DiskMarkService,
  type DiskReading,
  type HomeOffline,
  type StoragePeriod
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import type { GoneItem } from "../gone/Gone.ts"
import { dayOf } from "../home/Day.ts"
import { HomeDocuments, toOffline } from "../home/HomeLink.ts"
import { HomeTime } from "../home/HomeTime.ts"
import type { MediaDisk } from "./MediaDisks.ts"

const hourMs = 3600_000
const dayMs = 24 * hourMs

/** How far back each period reaches; All has no start. */
const periodMs: Record<StoragePeriod, number | undefined> = {
  "7d": 7 * dayMs,
  "30d": 30 * dayMs,
  "1y": 365 * dayMs,
  all: undefined
}

/** The first instant a period shows. */
export const periodStart = (period: StoragePeriod, now: number) => {
  const span = periodMs[period]
  return span === undefined ? Number.NEGATIVE_INFINITY : now - span
}

/** Hourly up to 30 days; beyond, a point a day is all a phone can draw. */
export const isDaily = (period: StoragePeriod) => period === "1y" || period === "all"

// Documents: `storage/disks/<id>` (what a disk is), `storage/readings/<id>/<yyyy-mm>` (a month of
// hourly readings), `storage/marks/<yyyy-mm>` (a month of marks). One month is a few dozen KB.

const disksPrefix = "storage/disks/"
const diskKey = (id: string) => `${disksPrefix}${id}`
const readingsPrefix = (id: string) => `storage/readings/${id}/`
const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7)
const readingsKey = (id: string, at: number) => `${readingsPrefix(id)}${monthOf(at)}`
const marksPrefix = "storage/marks/"
const marksKey = (at: number) => `${marksPrefix}${monthOf(at)}`

const StoredDisk = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  holds: Schema.Array(DiskHoldsSchema),
  totalBytes: Schema.Finite
})
type StoredDisk = typeof StoredDisk.Type

/** `[epoch milliseconds, free bytes]`: a pair, so a year of readings stays small. */
const Month = Schema.Struct({ readings: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])) })
type Month = typeof Month.Type

const StoredMark = Schema.Struct({
  id: Schema.String,
  at: Schema.Finite,
  kind: DiskMarkKind,
  service: DiskMarkService,
  title: Schema.String,
  detail: Schema.String,
  bytes: Schema.optionalKey(Schema.Finite),
  /** The disks it belongs on: those holding this; absent, every media disk (Quai can't tell). */
  holds: Schema.optionalKey(DiskHoldsSchema),
  /** An arrived mark of a series: how many episodes, and which seasons, it adds up. */
  episodes: Schema.optionalKey(Schema.Finite),
  seasons: Schema.optionalKey(Schema.Array(Schema.Finite))
})
export type StoredMark = typeof StoredMark.Type

const MarksMonth = Schema.Struct({ marks: Schema.Array(StoredMark) })

const decodeOr = <A>(schema: Schema.Codec<A, unknown>, fallback: A) => (value: Option.Option<unknown>): A =>
  Option.getOrElse(Option.flatMap(value, Schema.decodeUnknownOption(schema)), () => fallback)

/** A month with this reading: none twice in the same hour, the first of the hour kept. */
export const withReading = (month: Month, at: number, freeBytes: number): Month | null => {
  const last = month.readings.at(-1)
  if (last !== undefined && Math.floor(last[0] / hourMs) >= Math.floor(at / hourMs)) return null
  return { readings: [...month.readings, [at, freeBytes]] }
}

/** The readings a period shows: hourly as kept, or the last of each of the home's days. */
export const resolution = (
  readings: ReadonlyArray<DiskReading>,
  period: StoragePeriod,
  timeZone: string
): ReadonlyArray<DiskReading> => {
  if (!isDaily(period)) return readings
  const byDay = new Map<string, DiskReading>()
  for (const reading of readings) byDay.set(dayOf(reading.at, timeZone), reading)
  return [...byDay.values()]
}

/** A title's files imported: one arrived mark per title and day, added up. */
export interface Arrival {
  readonly service: "radarr" | "sonarr"
  /** The title as the journal knows it: `movie:tmdb:1`, `series:tvdb:1`. */
  readonly titleKey: string
  readonly title: string
  readonly at: number
  readonly bytes: number
  /** A series' episodes in this import. */
  readonly episodes?: ReadonlyArray<{ readonly season: number }>
}

/** "Severance S02" when every episode is of one season, the series alone otherwise. */
const seriesTitle = (title: string, seasons: ReadonlyArray<number>) =>
  seasons.length === 1 ? `${title} S${seasons[0]!.toString().padStart(2, "0")}` : title

/** "Imported", "8 episodes imported": the size is the mark's `bytes`, shown beside it. */
const arrivedDetail = (episodes: number | undefined) =>
  episodes === undefined ? "Imported" : `${episodes} episode${episodes === 1 ? "" : "s"} imported`

/** An import as the day's mark of its title: the first one, or added to the one already there. */
export const arrivedMark = (arrival: Arrival, day: string, known: StoredMark | undefined): StoredMark => {
  const bytes = (known?.bytes ?? 0) + arrival.bytes
  const holds: DiskHolds = arrival.service === "radarr" ? "movies" : "shows"
  if (arrival.episodes === undefined) {
    return {
      id: `arrived:${arrival.titleKey}:${day}`,
      at: known?.at ?? arrival.at,
      kind: "arrived",
      service: arrival.service,
      title: arrival.title,
      detail: arrivedDetail(undefined),
      ...(bytes > 0 ? { bytes } : {}),
      holds
    }
  }
  const episodes = (known?.episodes ?? 0) + arrival.episodes.length
  const seasons = [...new Set([...(known?.seasons ?? []), ...arrival.episodes.map((episode) => episode.season)])]
    .sort((left, right) => left - right)
  return {
    id: `arrived:${arrival.titleKey}:${day}`,
    at: known?.at ?? arrival.at,
    kind: "arrived",
    service: arrival.service,
    title: seriesTitle(arrival.title, seasons),
    detail: arrivedDetail(episodes),
    ...(bytes > 0 ? { bytes } : {}),
    holds,
    episodes,
    seasons
  }
}

/** Something gone, as its mark. */
export interface Departure {
  readonly service: "reclaimerr" | "cleanuparr"
  readonly at: number
  readonly title: string
  /** "Deleted", "Seed cleanup". */
  readonly detail: string
  /** Space surely back. */
  readonly bytes?: number
  readonly holds?: DiskHolds
}

const goneWords: Record<GoneItem["kind"], string> = {
  plannedDeletion: "Deleted",
  stuckRemoval: "Stuck removal",
  seedCleanup: "Seed cleanup"
}

/** Something gone as its mark says it: "Deleted", "Seed cleanup" (the service and the space back are shown beside). */
export const departureOf = (item: GoneItem): Departure => ({
  service: item.source,
  at: item.at,
  title: item.title,
  detail: item.moved === true ? "Moved" : goneWords[item.kind],
  ...(item.spaceBack === undefined ? {} : { bytes: item.spaceBack }),
  ...(item.holds === undefined ? {} : { holds: item.holds })
})

export const goneMark = (departure: Departure): StoredMark => ({
  id: `gone:${departure.service}:${departure.at}:${departure.title}`,
  at: departure.at,
  kind: "gone",
  service: departure.service,
  title: departure.title,
  detail: departure.detail,
  ...(departure.bytes === undefined || departure.bytes <= 0 ? {} : { bytes: departure.bytes }),
  ...(departure.holds === undefined ? {} : { holds: departure.holds })
})

/** Whether a mark goes on this disk: on those holding what it is about, on all when unknown. */
export const marksDisk = (mark: Pick<StoredMark, "holds">, disk: Pick<StoredDisk, "holds">) =>
  mark.holds === undefined || disk.holds.includes(mark.holds)

/** The mark as the app gets it. */
export const shownMark = (mark: StoredMark): DiskMark => ({
  id: mark.id,
  at: mark.at,
  kind: mark.kind,
  service: mark.service,
  title: mark.title,
  detail: mark.detail,
  ...(mark.bytes === undefined ? {} : { bytes: mark.bytes })
})

/**
 * The disk readings and their marks (GLOSSARY), kept as home documents: a reading an hour per media
 * disk and every mark, for good. Recording never fails: an offline home is logged and skipped.
 */
export class DiskReadings extends Context.Service<DiskReadings, {
  /** The disks' free space now, at most once an hour each. */
  readonly record: (disks: ReadonlyArray<MediaDisk>) => Effect.Effect<void>
  /** A title's files imported. */
  readonly arrived: (arrival: Arrival) => Effect.Effect<void>
  /** Something Upcoming showed as going, done. */
  readonly gone: (departure: Departure) => Effect.Effect<void>
  /** Every disk ever read. */
  readonly disks: Effect.Effect<ReadonlyArray<StoredDisk>, HomeOffline>
  /** A disk's readings since `from` (epoch milliseconds), oldest first. */
  readonly readings: (id: string, from: number) => Effect.Effect<ReadonlyArray<DiskReading>, HomeOffline>
  /** Every mark, newest first. */
  readonly marks: Effect.Effect<ReadonlyArray<StoredMark>, HomeOffline>
}>()("quai/DiskReadings") {
  static readonly layer = Layer.effect(
    DiskReadings,
    Effect.gen(function*() {
      const store = yield* HomeDocuments
      const time = yield* HomeTime
      const lock = yield* Semaphore.make(1)

      const logged = (what: string) => <E extends { readonly message: string }>(effect: Effect.Effect<void, E>) =>
        effect.pipe(
          Effect.catch((error) => Effect.logWarning(`${what} not kept: ${error.message}`)),
          lock.withPermits(1)
        )

      const recordOne = (disk: MediaDisk, at: number) =>
        Effect.gen(function*() {
          const meta: StoredDisk = { id: disk.id, name: disk.name, holds: disk.holds, totalBytes: disk.totalBytes }
          const known = decodeOr(Schema.NullOr(StoredDisk), null)(yield* store.get(diskKey(disk.id)))
          if (JSON.stringify(known) !== JSON.stringify(meta)) yield* store.put(diskKey(disk.id), meta)
          const key = readingsKey(disk.id, at)
          const month = withReading(decodeOr(Month, { readings: [] })(yield* store.get(key)), at, disk.freeBytes)
          if (month !== null) yield* store.put(key, month)
        })

      const marksIn = (key: string) => Effect.map(store.get(key), decodeOr(MarksMonth, { marks: [] }))

      const putMark = (key: string, change: (marks: ReadonlyArray<StoredMark>) => ReadonlyArray<StoredMark>) =>
        Effect.flatMap(marksIn(key), (month) => store.put(key, { marks: change(month.marks) }))

      const replacing = (mark: StoredMark) => (marks: ReadonlyArray<StoredMark>) => [
        ...marks.filter((known) => known.id !== mark.id),
        mark
      ]

      const months = <A>(prefix: string, schema: Schema.Codec<A, unknown>) =>
        Effect.map(
          Effect.mapError(store.list(prefix), toOffline),
          (documents) =>
            documents.flatMap((document) => Option.toArray(Schema.decodeUnknownOption(schema)(document.value)))
        )

      return {
        record: (disks) =>
          Effect.flatMap(
            Clock.currentTimeMillis,
            (at) => Effect.forEach(disks, (disk) => recordOne(disk, at), { discard: true })
          ).pipe(logged("disk reading")),
        arrived: (arrival) =>
          Effect.gen(function*() {
            const day = dayOf(arrival.at, yield* time.zone)
            // The home's day picks the month: a day that starts in the previous UTC month is still one mark.
            const key = `${marksPrefix}${day.slice(0, 7)}`
            const known = (yield* marksIn(key)).marks.find((mark) => mark.id === `arrived:${arrival.titleKey}:${day}`)
            yield* putMark(key, replacing(arrivedMark(arrival, day, known)))
          }).pipe(logged("arrived mark")),
        gone: (departure) => putMark(marksKey(departure.at), replacing(goneMark(departure))).pipe(logged("gone mark")),
        disks: months(disksPrefix, StoredDisk),
        readings: (id, from) =>
          Effect.map(months(readingsPrefix(id), Month), (all) =>
            all.flatMap((month) => month.readings)
              .filter(([at]) => at >= from)
              .map(([at, freeBytes]) => ({ at, freeBytes }))),
        marks: Effect.map(
          months(marksPrefix, MarksMonth),
          (all) => all.flatMap((month) => month.marks).sort((left, right) => right.at - left.at)
        )
      }
    })
  )
}
