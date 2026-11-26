import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { LibraryService } from "./Library.ts"
import { Service } from "./Service.ts"

/** The stretch of time the Storage screen shows: hourly readings on 7 and 30 days, daily beyond. */
export const StoragePeriod = Schema.Literals(["7d", "30d", "1y", "all"]).annotate({ identifier: "StoragePeriod" })
export type StoragePeriod = typeof StoragePeriod.Type

/** What a media disk holds: Radarr's root folders (movies), Sonarr's (shows). */
export const DiskHolds = Schema.Literals(["movies", "shows"]).annotate({ identifier: "DiskHolds" })
export type DiskHolds = typeof DiskHolds.Type

/** One disk reading: the disk's free space at that hour. */
export const DiskReading = Schema.Struct({
  /** Epoch milliseconds. */
  at: Schema.Finite,
  freeBytes: Schema.Finite
}).annotate({ identifier: "DiskReading" })
export type DiskReading = typeof DiskReading.Type

/** A disk mark's kind: a title's files imported (*arrived*), or something Upcoming showed as going, done (*gone*). */
export const DiskMarkKind = Schema.Literals(["arrived", "gone"]).annotate({ identifier: "DiskMarkKind" })
export type DiskMarkKind = typeof DiskMarkKind.Type

/** The services a disk mark comes from. */
export const DiskMarkService = Service.pick(["radarr", "sonarr", "reclaimerr", "cleanuparr"]).annotate({
  identifier: "DiskMarkService"
})
export type DiskMarkService = typeof DiskMarkService.Type

/** Something that happened, placed on a disk's readings (GLOSSARY: disk mark). */
export const DiskMark = Schema.Struct({
  /** Stable across reads, to select it. */
  id: Schema.String,
  /** Epoch milliseconds: an arrived mark is dated by its first import that day. */
  at: Schema.Finite,
  kind: DiskMarkKind,
  service: DiskMarkService,
  /** "Severance S02", "Dune: Part Two". */
  title: Schema.String,
  /** What happened, in words: "8 episodes imported", "Seed cleanup"; its size is `bytes`. */
  detail: Schema.String,
  /** What it took (arrived) or gave back for sure (gone); absent when Quai can't say. */
  bytes: Schema.optionalKey(Schema.Finite)
}).annotate({ identifier: "DiskMark" })
export type DiskMark = typeof DiskMark.Type

/** One media disk on the Storage screen, over the period asked. */
export const StorageDisk = Schema.Struct({
  id: Schema.String,
  /** What it holds, in words: "Movies", "Shows", "Movies · Shows". */
  name: Schema.String,
  holds: Schema.Array(DiskHolds),
  freeBytes: Schema.Finite,
  totalBytes: Schema.Finite,
  /** Under the disk low alert's threshold (the alert on). */
  low: Schema.Boolean,
  /** Free space now minus at the period's first reading; absent without an earlier reading. */
  changeBytes: Schema.optionalKey(Schema.Finite),
  /** Oldest first: hourly on 7 and 30 days, one a day (its last) beyond. */
  readings: Schema.Array(DiskReading),
  /** The period's marks, newest first. */
  marks: Schema.Array(DiskMark),
  /** Every mark the disk has, whatever the period. */
  allMarks: Schema.Finite
}).annotate({ identifier: "StorageDisk" })
export type StorageDisk = typeof StorageDisk.Type

export const Storage = Schema.Struct({
  period: StoragePeriod,
  /** Fullest first (the smallest share free). */
  disks: Schema.Array(StorageDisk),
  /** Services Quai Home reaches that couldn't be read this time: their disks show their last reading. */
  unavailable: Schema.Array(LibraryService)
}).annotate({ identifier: "Storage" })
export type Storage = typeof Storage.Type

/** The media disks' free space over time and what happened to it, for the app's Storage screen. */
export class StorageGroup extends HttpApiGroup.make("storage")
  .add(
    HttpApiEndpoint.get("storage", "/storage", {
      query: { period: Schema.optionalKey(StoragePeriod) },
      success: Storage
    })
      .annotate(OpenApi.Identifier, "getStorage")
      .middleware(DeviceAuth)
  )
  .middleware(HomeRequired)
  .prefix("/api")
{}
