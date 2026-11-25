import type { Release } from "@quai/api"
import { Schema } from "effect"
import type { Read } from "../home/HomeReads.ts"

/**
 * What Radarr and Sonarr share: they run on the same framework, so their images, dates, queue,
 * release search and manual import differ only in the fields naming the media. Only the fields
 * Quai reads; Radarr v5/v6 and Sonarr v4.
 */

/** One of an *arr's images: only its kind and public URL. */
export const ArrImage = Schema.Struct({
  coverType: Schema.String,
  remoteUrl: Schema.optional(Schema.String)
})

const Images = Schema.optional(Schema.Array(ArrImage))

/** The poster's public URL (TMDB, TheTVDB). Never the service's own `url`: that one needs its key. */
export const posterOf = (images: ReadonlyArray<typeof ArrImage.Type> | undefined): string | undefined => {
  const remote = images?.find((image) => image.coverType === "poster")?.remoteUrl
  return remote !== undefined && /^https:\/\//.test(remote) ? remote : undefined
}

/** Epoch seconds of an *arr date; their "unknown" is year 1 (`0001-01-01T00:00:00Z`). */
export const epochSeconds = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) || ms <= 0 ? undefined : Math.floor(ms / 1000)
}

/** A year the *arr knows: they write 0 when they don't. */
export const knownYear = (year: number | undefined) => year !== undefined && year > 0 ? Math.trunc(year) : undefined

const StatusMessage = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  messages: Schema.optional(Schema.NullOr(Schema.Array(Schema.String)))
})

/** One row of `GET /api/v3/queue`, with `includeMovie` (Radarr) or `includeSeries` + `includeEpisode` (Sonarr). */
export const QueueRecord = Schema.Struct({
  id: Schema.Number,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  /** ok, warning, error. */
  trackedDownloadStatus: Schema.optional(Schema.String),
  /** downloading, importBlocked, importPending, importing, imported, failedPending, failed, ignored. */
  trackedDownloadState: Schema.optional(Schema.String),
  statusMessages: Schema.optional(Schema.NullOr(Schema.Array(StatusMessage))),
  downloadId: Schema.optional(Schema.NullOr(Schema.String)),
  downloadClient: Schema.optional(Schema.NullOr(Schema.String)),
  added: Schema.optional(Schema.String),
  /** Bytes, the whole download's and what's left of it. */
  size: Schema.optional(Schema.Number),
  sizeleft: Schema.optional(Schema.Number),
  // Radarr
  movieId: Schema.optional(Schema.NullOr(Schema.Number)),
  movie: Schema.optional(Schema.Struct({
    title: Schema.String,
    year: Schema.optional(Schema.Number),
    hasFile: Schema.optional(Schema.Boolean),
    images: Images
  })),
  // Sonarr
  seriesId: Schema.optional(Schema.NullOr(Schema.Number)),
  episodeId: Schema.optional(Schema.NullOr(Schema.Number)),
  seasonNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  series: Schema.optional(Schema.Struct({
    title: Schema.String,
    year: Schema.optional(Schema.Number),
    images: Images
  })),
  episode: Schema.optional(Schema.Struct({
    seasonNumber: Schema.Number,
    episodeNumber: Schema.Number,
    hasFile: Schema.optional(Schema.Boolean)
  }))
})
export type QueueRecord = typeof QueueRecord.Type

export const QueuePage = Schema.Struct({ records: Schema.Array(QueueRecord) })

/** The queue's largest page: one read covers any home's queue. */
export const queuePageSize = 500

/** The grabs since `ms` (epoch milliseconds). */
export const grabsSincePath = (ms: number) => `/api/v3/history/since?date=${encodeURIComponent(new Date(ms).toISOString())}&eventType=grabbed`

/** How far back the grabs are read: a grab older than this, still without a file, doesn't count. */
export const grabLookbackMs = 30 * 24 * 3600_000

/**
 * A finished download the *arr won't import on its own: blocked (a sample, not an upgrade, no
 * match), or waiting for a manual import with a warning ("name doesn't match any episode").
 */
/** What a Live Activity says while Radarr or Sonarr waits for someone to import the download. */
export const importBlockedDetail = "Import blocked · see To fix"

export const isImportBlocked = (record: QueueRecord) => {
  const state = record.trackedDownloadState
  return state === "importBlocked" || state === "importFailed" ||
    (state === "importPending" && record.trackedDownloadStatus === "warning")
}

/** The *arr's messages, flattened: each entry is titled with a file name, or is the message itself. */
export const queueMessages = (record: QueueRecord): ReadonlyArray<string> => {
  const lines = (record.statusMessages ?? []).flatMap((message) => {
    const messages = (message.messages ?? []).filter((text) => text !== "")
    return messages.length > 0 ? messages : message.title !== undefined && message.title !== null && message.title !== "" ? [message.title] : []
  })
  return [...new Set(lines)]
}

/** One release of `GET /api/v3/release` (an interactive search). */
export const ReleaseRecord = Schema.Struct({
  guid: Schema.String,
  indexerId: Schema.Number,
  indexer: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  size: Schema.optional(Schema.Number),
  protocol: Schema.optional(Schema.String),
  seeders: Schema.optional(Schema.NullOr(Schema.Number)),
  leechers: Schema.optional(Schema.NullOr(Schema.Number)),
  quality: Schema.optional(Schema.Struct({ quality: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })) })),
  languages: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String) })))),
  ageHours: Schema.optional(Schema.Number),
  age: Schema.optional(Schema.Number),
  customFormatScore: Schema.optional(Schema.Number),
  rejected: Schema.optional(Schema.Boolean),
  rejections: Schema.optional(Schema.NullOr(Schema.Array(Schema.Union([Schema.String, Schema.Struct({ reason: Schema.optional(Schema.String) })])))),
  /** Sonarr: the episodes the release covers. */
  mappedEpisodeInfo: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.Number) }))))
})
export type ReleaseRecord = typeof ReleaseRecord.Type
export const ReleaseRecords = Schema.Array(ReleaseRecord)

const reasonsOf = (rejections: ReadonlyArray<string | { readonly reason?: string | undefined }> | null | undefined) =>
  (rejections ?? []).map((rejection) => typeof rejection === "string" ? rejection : rejection.reason ?? "").filter((reason) => reason !== "")

export const toRelease = (record: ReleaseRecord): Release => {
  const rejections = reasonsOf(record.rejections)
  return {
    guid: record.guid,
    indexerId: record.indexerId,
    indexer: record.indexer ?? "",
    title: record.title ?? "",
    sizeBytes: record.size ?? 0,
    protocol: record.protocol ?? "unknown",
    ...(record.seeders === undefined || record.seeders === null ? {} : { seeders: Math.trunc(record.seeders) }),
    ...(record.leechers === undefined || record.leechers === null ? {} : { leechers: Math.trunc(record.leechers) }),
    quality: record.quality?.quality?.name ?? "Unknown",
    languages: (record.languages ?? []).flatMap((language) => language.name === undefined ? [] : [language.name]),
    ageHours: record.ageHours ?? (record.age ?? 0) * 24,
    ...(record.customFormatScore === undefined ? {} : { customFormatScore: Math.trunc(record.customFormatScore) }),
    rejected: record.rejected ?? rejections.length > 0,
    rejections
  }
}

/** Accepted ones first, then the best seeded. */
export const byPreference = (left: Release, right: Release) =>
  Number(left.rejected) - Number(right.rejected) || (right.seeders ?? -1) - (left.seeders ?? -1) || left.ageHours - right.ageHours

/** One file of `GET /api/v3/manualimport?downloadId=`, as the *arr matched it. */
export const ManualImportRow = Schema.Struct({
  path: Schema.optional(Schema.String),
  relativePath: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  size: Schema.optional(Schema.Number),
  quality: Schema.optional(Schema.Unknown),
  languages: Schema.optional(Schema.Unknown),
  releaseGroup: Schema.optional(Schema.NullOr(Schema.String)),
  indexerFlags: Schema.optional(Schema.Number),
  movie: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Number, hasFile: Schema.optional(Schema.Boolean) }))),
  series: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  seasonNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  episodes: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({
    id: Schema.Number,
    seasonNumber: Schema.Number,
    episodeNumber: Schema.Number,
    hasFile: Schema.optional(Schema.Boolean)
  })))),
  rejections: Schema.optional(Schema.NullOr(Schema.Array(Schema.Union([Schema.String, Schema.Struct({ reason: Schema.optional(Schema.String) })]))))
})
export type ManualImportRow = typeof ManualImportRow.Type
export const ManualImportRows = Schema.Array(ManualImportRow)

/** How a file is named to the user and in `ImportDownload`: its path inside the download. */
export const fileOf = (row: ManualImportRow) => row.relativePath ?? row.name ?? row.path?.split("/").pop() ?? ""

export const rejectionsOf = (row: ManualImportRow) => reasonsOf(row.rejections)

/** The quality's name in a manual import row (`{ quality: { name } }`), when it has one. */
export const qualityName = (quality: unknown): string | undefined => {
  if (typeof quality !== "object" || quality === null || !("quality" in quality)) return undefined
  const inner = quality.quality
  return typeof inner === "object" && inner !== null && "name" in inner && typeof inner.name === "string" ? inner.name : undefined
}

/** The parts of a row `ManualImport` takes back as they were read: inventing a quality imports a file as what it isn't. */
export const echoed = (row: ManualImportRow) => ({
  ...(row.quality === undefined ? {} : { quality: row.quality }),
  ...(row.languages === undefined ? {} : { languages: row.languages }),
  ...(typeof row.releaseGroup === "string" ? { releaseGroup: row.releaseGroup } : {}),
  ...(row.indexerFlags === undefined ? {} : { indexerFlags: row.indexerFlags })
})


/** `GET /api/v3/config/mediamanagement`: whether imports are hardlinks (the same files) or copies. */
export const MediaManagement = Schema.Struct({ copyUsingHardlinks: Schema.Boolean })

export const mediaManagementRead = <S extends "radarr" | "sonarr">(service: S): Read<typeof MediaManagement.Type> & { readonly service: S } => ({
  service,
  path: "/api/v3/config/mediamanagement",
  schema: MediaManagement
})

/**
 * The one season a release name covers ("S02", "S02E05"). Undefined when it names none or several
 * ("S01-S03", "S01.S02", "Complete"): the release is the whole series, as far as Quai can tell.
 */
export const seasonOfRelease = (name: string): number | undefined => {
  if (/(?:^|[^a-z0-9])s\d{1,2}\s*[-–]\s*s?\d{1,2}(?:[^a-z0-9]|$)/i.test(name)) return undefined
  const seasons = new Set([...name.matchAll(/(?:^|[^a-z0-9])s(\d{1,2})(?:e\d{1,3})*(?=[^a-z0-9]|$)/gi)].map((match) => Number(match[1])))
  return seasons.size === 1 ? [...seasons][0] : undefined
}
