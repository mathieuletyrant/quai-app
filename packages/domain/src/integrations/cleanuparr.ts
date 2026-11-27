import { type JournalNote, type RemovalReason } from "@quai/api"
import { Effect, Option, Schema } from "effect"
import type { Detected, RemovalTarget } from "../fixes/Detected.ts"
import * as FixId from "../fixes/FixId.ts"
import type { QueuedMedia } from "../fixes/MediaFixes.ts"
import { type GoneItem, goneItem } from "../gone/Gone.ts"
import type { Read } from "../home/HomeReads.ts"
import type { Journal } from "../journal/Journal.ts"
import { epochSeconds, type QueueRecord } from "./arr.ts"
import { eventFeed, unseenSince } from "./EventFeed.ts"

/**
 * A download as Radarr and Sonarr name it, and Cleanuparr after them: a torrent's info hash, or
 * SABnzbd's job id. Never a category, a tag or a tracker, which Cleanuparr's ignore list also takes
 * and which would spare every download they cover.
 */
export const isDownloadId = (value: unknown) =>
  typeof value === "string" && (/^[0-9a-fA-F]{40}$/.test(value) || /^SABnzbd_nzo_[A-Za-z0-9_]{1,80}$/.test(value))
import { type Integration, readSnapshot, watchOf } from "./Integration.ts"

/**
 * Cleanuparr (github.com/Cleanuparr/Cleanuparr, 2.11): removes stalled, slow, failed-import and
 * errored downloads from the *arr queues once they have enough strikes. Its API takes the account's
 * key as `X-Api-Key` (Settings > Account); every route but `/health` needs it.
 *
 * It feeds the To fix list (a download it removes at its next strike), the journal and Gone (what it
 * removed or cleaned, polled from its events): no flow event, no Live Activity action.
 */

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const

/** `DownloadItemStrikesDto` (Features/Strikes/Contracts/Responses), only the fields Quai reads. */
const StruckDownload = Schema.Struct({
  /** Cleanuparr's own id of the download (a UUID): the fix id. */
  downloadItemId: Schema.String,
  /** The *arr's download id: a torrent's info hash, SABnzbd's job id. */
  downloadId: Schema.String,
  /** The release, as the download client names it. */
  title: Schema.String,
  isMarkedForRemoval: Schema.optional(Schema.Boolean),
  isRemoved: Schema.optional(Schema.Boolean),
  /** Newest first. `type`: Stalled, DownloadingMetadata, FailedImport, SlowSpeed, SlowTime, DeadTorrent, Errored. */
  strikes: Schema.Array(Schema.Struct({
    type: Schema.String,
    createdAt: Schema.String,
    /** Struck while Cleanuparr ran dry: it never counts toward a real removal. */
    isDryRun: Schema.optional(Schema.Boolean)
  }))
})
export type StruckDownload = typeof StruckDownload.Type

/** `GET /api/strikes`: the downloads with strikes, most recently struck first. 500 is its largest page. */
export const strikesRead: Read<{ readonly items: ReadonlyArray<StruckDownload> }> = {
  service: "cleanuparr",
  path: "/api/strikes?page=1&pageSize=500",
  schema: Schema.Struct({ items: Schema.Array(StruckDownload) })
}

/** A limit Cleanuparr gives as `{ maxStrikes, … }`; 0 turns the check off. */
const Limit = Schema.StructWithRest(Schema.Struct({ maxStrikes: Schema.Number }), Rest)

/**
 * `QueueCleanerConfigResponse` (Features/QueueCleaner/Contracts/Responses): the fields Quai's rules
 * read. Keep sends back what Cleanuparr answered, not this (`excluding`).
 */
const QueueCleanerSettings = Schema.StructWithRest(
  Schema.Struct({
    enabled: Schema.Boolean,
    failedImport: Limit,
    downloadingMetadataMaxStrikes: Schema.Number,
    errored: Schema.optional(Schema.NullOr(Limit)),
    /** Download ids, categories, tags or trackers the queue cleaner leaves alone. */
    ignoredDownloads: Schema.NullOr(Schema.Array(Schema.String))
  }),
  Rest
)
export type QueueCleanerSettings = typeof QueueCleanerSettings.Type

/** The queue cleaner's settings: the strike limits, and what it leaves alone. */
export const settingsRead: Read<QueueCleanerSettings> = {
  service: "cleanuparr",
  path: "/api/configuration/queue_cleaner",
  schema: QueueCleanerSettings
}

/** `StallRuleResponse` and `SlowRuleResponse`: which downloads a rule covers, and its limit. */
const QueueRules = Schema.Array(Schema.Struct({
  enabled: Schema.Boolean,
  maxStrikes: Schema.Number,
  minCompletionPercentage: Schema.Number,
  maxCompletionPercentage: Schema.Number
}))
export type QueueRules = typeof QueueRules.Type

export const stallRulesRead: Read<QueueRules> = {
  service: "cleanuparr",
  path: "/api/queue-rules/stall",
  schema: QueueRules
}
export const slowRulesRead: Read<QueueRules> = {
  service: "cleanuparr",
  path: "/api/queue-rules/slow",
  schema: QueueRules
}

/** `JobInfo`: when the queue cleaner runs next (none when it isn't scheduled). */
export const queueCleanerJobRead: Read<{ readonly nextRunTime?: string | null | undefined }> = {
  service: "cleanuparr",
  path: "/api/jobs/QueueCleaner",
  schema: Schema.Struct({ nextRunTime: Schema.optional(Schema.NullOr(Schema.String)) })
}

/** `EventListItem` of a `QueueItemDeleted` event (Features/Events/Contracts/Responses). */
const RemovalEvent = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  itemTitle: Schema.optional(Schema.NullOr(Schema.String)),
  itemHash: Schema.optional(Schema.NullOr(Schema.String)),
  /** `DeleteReason`: Stalled, FailedImport, DownloadingMetadata, SlowSpeed, SlowTime, AllFilesSkipped… */
  deleteReason: Schema.optional(Schema.NullOr(Schema.String)),
  removeFromClient: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isDryRun: Schema.optional(Schema.Boolean)
})
export type RemovalEvent = typeof RemovalEvent.Type

/** The last downloads Cleanuparr removed from a queue, newest first. */
export const removalsRead: Read<{ readonly items: ReadonlyArray<RemovalEvent> }> = {
  service: "cleanuparr",
  path: "/api/events?page=1&pageSize=50&eventType=QueueItemDeleted",
  schema: Schema.Struct({ items: Schema.Array(RemovalEvent) })
}

/** `EventListItem` of a `DownloadCleaned` event: a finished torrent the download cleaner took out of the client. */
const CleanedEvent = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  itemTitle: Schema.optional(Schema.NullOr(Schema.String)),
  itemHash: Schema.optional(Schema.NullOr(Schema.String)),
  /** `CleanReason`: MaxRatioReached, MaxSeedTimeReached. */
  cleanReason: Schema.optional(Schema.NullOr(Schema.String)),
  seedRatio: Schema.optional(Schema.NullOr(Schema.Number)),
  seedingTimeHours: Schema.optional(Schema.NullOr(Schema.Number)),
  isDryRun: Schema.optional(Schema.Boolean)
})
export type CleanedEvent = typeof CleanedEvent.Type

/** The last torrents the download cleaner took out of the client, newest first. */
export const cleanedRead: Read<{ readonly items: ReadonlyArray<CleanedEvent> }> = {
  service: "cleanuparr",
  path: "/api/events?page=1&pageSize=50&eventType=DownloadCleaned",
  schema: Schema.Struct({ items: Schema.Array(CleanedEvent) })
}

// The To fix list: what Cleanuparr removes at its next strike.

/** What Cleanuparr counts for each kind of strike, and why that removes a download, in words. */
const strikeKinds: Record<string, { readonly reason: RemovalReason; readonly words: string }> = {
  Stalled: { reason: "stalled", words: "Stalled, no progress" },
  SlowSpeed: { reason: "slow", words: "Downloading too slowly" },
  SlowTime: { reason: "slow", words: "Would take too long to finish" },
  FailedImport: { reason: "failedImport", words: "Its import keeps failing" },
  DownloadingMetadata: { reason: "downloadingMetadata", words: "Stuck downloading its metadata" },
  Errored: { reason: "errored", words: "The download client reports an error" }
}

/** How far a download got, from its queue row: Cleanuparr's rules cover a range of it. */
export const completion = (records: ReadonlyArray<QueueRecord>): number | undefined => {
  const record = records[0]
  if (record?.size === undefined || record.sizeleft === undefined || record.size <= 0) return undefined
  return Math.min(100, Math.max(0, (1 - record.sizeleft / record.size) * 100))
}

/** A rule's range, as `QueueRule.MatchesCompletionPercentage` reads it: above its minimum (0 included), up to its maximum. */
const covers = (rule: QueueRules[number], percent: number) =>
  rule.maxCompletionPercentage >= rule.minCompletionPercentage &&
  (rule.minCompletionPercentage === 0 ? percent >= 0 : percent > rule.minCompletionPercentage) &&
  percent <= rule.maxCompletionPercentage

/**
 * The strikes that remove a download for a stall or a slow rule: the enabled rules covering how far
 * it got (any, when that's unknown), the lowest of their limits. Cleanuparr also picks by private
 * or public torrent and by upgrade, which Quai can't see: the lowest is the soonest it can go.
 */
export const ruleLimit = (rules: QueueRules, percent: number | undefined): number => {
  const limits = rules.filter((rule) =>
    rule.enabled && rule.maxStrikes > 0 && (percent === undefined || covers(rule, percent))
  ).map((rule) => rule.maxStrikes)
  return limits.length === 0 ? 0 : Math.min(...limits)
}

/** A download in Radarr's or Sonarr's queue, by its download id; undefined when neither has it. */
export type QueuedDownload = (
  downloadId: string
) => { readonly media: QueuedMedia; readonly records: ReadonlyArray<QueueRecord> } | undefined

/** The downloads of the queues read, by download id (any case): each named by its adapter, from all its rows. */
export const queuedByDownload = (
  queues: ReadonlyArray<
    {
      readonly queued: (records: ReadonlyArray<QueueRecord>) => QueuedMedia
      readonly records: ReadonlyArray<QueueRecord>
    }
  >
): QueuedDownload => {
  const found = new Map<string, { readonly media: QueuedMedia; readonly records: ReadonlyArray<QueueRecord> }>()
  for (const { queued, records } of queues) {
    const grouped = new Map<string, Array<QueueRecord>>()
    for (const record of records) {
      const id = record.downloadId?.toLowerCase()
      if (id !== undefined && id !== "") grouped.set(id, [...grouped.get(id) ?? [], record])
    }
    for (const [id, rows] of grouped) found.set(id, { media: queued(rows), records: rows })
  }
  return (downloadId) => found.get(downloadId.toLowerCase())
}

/** What the queue cleaner works with, read beforehand. */
export interface RemovalInput {
  readonly downloads: ReadonlyArray<StruckDownload>
  readonly settings: QueueCleanerSettings
  readonly stallRules: QueueRules
  readonly slowRules: QueueRules
  /** Epoch seconds of its next run, when scheduled. */
  readonly nextRunAt: number | undefined
  readonly queued: QueuedDownload
}

const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** Whether the queue cleaner leaves this download alone (its own ignore list, by download id). */
export const isIgnored = (settings: QueueCleanerSettings, downloadId: string) =>
  (settings.ignoredDownloads ?? []).some((entry) => sameId(entry, downloadId))

/** The downloads that may be planned for removal: struck, not removed yet, not left alone, while the queue cleaner runs. */
export const struckDownloads = (input: Pick<RemovalInput, "downloads" | "settings">): ReadonlyArray<StruckDownload> =>
  input.settings.enabled
    ? input.downloads.filter((download) =>
      download.isRemoved !== true && !isIgnored(input.settings, download.downloadId) &&
      download.strikes.some((strike) => strike.isDryRun !== true)
    )
    : []

/**
 * The downloads Cleanuparr removes from a queue at its next strike: still in Radarr's or Sonarr's
 * queue, one strike short of a limit (or at it, marked for removal), soonest first. Cleanuparr
 * strikes once per run while the download stays stalled, slow or blocked, and removes it on the
 * strike that reaches the limit; a download that recovers loses its strikes instead (when its rule
 * says so), and goes from the list.
 */
export const stuckRemovals = (input: RemovalInput): ReadonlyArray<Detected<RemovalTarget>> =>
  struckDownloads(input).flatMap((download): ReadonlyArray<Detected<RemovalTarget>> => {
    const found = input.queued(download.downloadId)
    if (found === undefined) return []
    const percent = completion(found.records)
    const limitOf = (type: string): number =>
      type === "Stalled"
        ? ruleLimit(input.stallRules, percent)
        : type === "SlowSpeed" || type === "SlowTime"
        ? ruleLimit(input.slowRules, percent)
        : type === "FailedImport"
        ? input.settings.failedImport.maxStrikes
        : type === "DownloadingMetadata"
        ? input.settings.downloadingMetadataMaxStrikes
        : type === "Errored"
        ? input.settings.errored?.maxStrikes ?? 0
        : 0
    const counted = new Map<string, Array<typeof download.strikes[number]>>()
    for (const strike of download.strikes) {
      if (strike.isDryRun === true || strikeKinds[strike.type] === undefined) continue
      counted.set(strike.type, [...counted.get(strike.type) ?? [], strike])
    }
    const due = [...counted].flatMap(([type, strikes]) => {
      const limit = limitOf(type)
      const left = limit - strikes.length
      const planned = limit > 0 && (left === 1 || (left <= 0 && download.isMarkedForRemoval === true))
      return planned ? [{ type, strikes, limit, left }] : []
    }).sort((left, right) => left.left - right.left)
    const first = due[0]
    if (first === undefined) return []
    const kind = strikeKinds[first.type]!
    const since = Math.min(...first.strikes.map((strike) => epochSeconds(strike.createdAt) ?? Infinity))
    const { media } = found
    return [{
      fix: {
        id: FixId.removal(download.downloadItemId),
        kind: "stuckRemoval",
        service: "cleanuparr",
        title: media.title,
        ...(media.year === undefined ? {} : { year: media.year }),
        ...(media.posterUrl === undefined ? {} : { posterUrl: media.posterUrl }),
        reason: kind.reason === "failedImport" ? media.messages[0] ?? kind.words : kind.words,
        ...(Number.isFinite(since) ? { since } : {}),
        // Keep adds the download id to the ignore list: only a torrent hash or a SABnzbd job.
        actions: isDownloadId(download.downloadId) ? ["keep", "letGo"] : ["letGo"],
        removal: {
          release: download.title,
          reason: kind.reason,
          strikes: first.strikes.length,
          maxStrikes: first.limit,
          ...(input.nextRunAt === undefined ? {} : { removesAt: input.nextRunAt })
        }
      },
      target: { kind: "removal", downloadItemId: download.downloadItemId, downloadId: download.downloadId }
    }]
  }).sort((left, right) => strikesLeft(left) - strikesLeft(right))

const strikesLeft = (detected: Detected<RemovalTarget>) =>
  (detected.fix.removal?.maxStrikes ?? 0) - (detected.fix.removal?.strikes ?? 0)

const decodeAnswered = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
const isStrings = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

/**
 * Keep, Cleanuparr's only write: the queue cleaner's settings exactly as it answered them (the body
 * of `settingsRead`'s GET), with the download added to the ignore list. Nothing else is touched,
 * since Quai Home lets the write through only if nothing else changed. None for an answer that
 * isn't settings with a list (null is an empty one).
 */
export const excluding = (answered: string, downloadId: string): Option.Option<Record<string, unknown>> =>
  Option.flatMap(decodeAnswered(answered), (settings) => {
    const ignored = settings.ignoredDownloads === null ? [] : settings.ignoredDownloads
    return isStrings(ignored) ? Option.some({ ...settings, ignoredDownloads: [...ignored, downloadId] }) : Option.none()
  })

// Upcoming: what Cleanuparr's download cleaner takes out of qBittorrent once it seeded enough.

/** `SeedingRuleResponse` (Features/DownloadCleaner/Contracts/Responses): when a finished torrent goes. */
const SeedingRule = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  categories: Schema.Array(Schema.String),
  trackerPatterns: Schema.optional(Schema.Array(Schema.String)),
  tagsAny: Schema.optional(Schema.Array(Schema.String)),
  tagsAll: Schema.optional(Schema.Array(Schema.String)),
  /** Rules are tried from the lowest number: the first that matches is the torrent's. */
  priority: Schema.Number,
  /** Public, Private or Both. */
  privacyType: Schema.String,
  /** -1 turns the ratio check off. */
  maxRatio: Schema.Number,
  /** Hours the ratio check waits for. */
  minSeedTime: Schema.Number,
  /** Hours; -1 turns the seed time check off, 0 takes the torrent at once. */
  maxSeedTime: Schema.Number,
  minSeeders: Schema.optional(Schema.NullOr(Schema.Number)),
  maxInactiveDays: Schema.optional(Schema.NullOr(Schema.Number)),
  deleteSourceFiles: Schema.Boolean,
  /** Delete, or Stop (the torrent stays in the client, paused). */
  action: Schema.String
})
export type SeedingRule = typeof SeedingRule.Type

/** `GET /api/configuration/download_cleaner`: the fields Quai reads, no secret in them. */
export const DownloadCleanerSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** Download ids, categories or tags the download cleaner leaves alone. */
  ignoredDownloads: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  clients: Schema.Array(Schema.Struct({
    downloadClientName: Schema.String,
    downloadClientEnabled: Schema.Boolean,
    /** "qBittorrent", "Transmission"… */
    downloadClientTypeName: Schema.String,
    seedingRules: Schema.Array(SeedingRule),
    /** Torrents no hardlink holds go to `targetCategory`: their files aren't in the library. */
    unlinkedConfig: Schema.optional(Schema.NullOr(Schema.Struct({
      enabled: Schema.Boolean,
      targetCategory: Schema.String
    })))
  }))
})
export type DownloadCleanerSettings = typeof DownloadCleanerSettings.Type

export const downloadCleanerRead: Read<DownloadCleanerSettings> = {
  service: "cleanuparr",
  path: "/api/configuration/download_cleaner",
  schema: DownloadCleanerSettings
}

/** `JobInfo`: when the download cleaner runs next. */
export const downloadCleanerJobRead: Read<{ readonly nextRunTime?: string | null | undefined }> = {
  service: "cleanuparr",
  path: "/api/jobs/DownloadCleaner",
  schema: Schema.Struct({ nextRunTime: Schema.optional(Schema.NullOr(Schema.String)) })
}

/** A finished torrent as the download cleaner looks at it (qBittorrent's `/api/v2/torrents/info`). */
export interface SeedingTorrent {
  readonly hash: string
  readonly name: string
  readonly category?: string | undefined
  readonly tags?: string | undefined
  readonly progress: number
  readonly ratio: number
  /** Seconds it has seeded. */
  readonly seeding_time: number
  /** qBittorrent 5: from a private tracker. */
  readonly private?: boolean | null | undefined
  readonly state: string
}

/**
 * When the download cleaner takes a torrent: `at` that moment; `by` then at the latest (a ratio
 * may take it sooner); `from` then at the earliest (it waits for seeders or inactivity too, maybe
 * forever).
 */
export type CleanupTiming = "at" | "by" | "from"

/** When the download cleaner takes a torrent, and what that does to its files. */
export interface SeedCleanup<T extends SeedingTorrent = SeedingTorrent> {
  readonly torrent: T
  readonly rule: SeedingRule
  /** Epoch milliseconds it goes; undefined when only a ratio takes it (no date can be known). */
  readonly at: number | undefined
  readonly timing: CleanupTiming
  /** The rule takes it at once, at the next run: nothing to plan. */
  readonly atOnce: boolean
  /** Its files go with it (Delete, with the source files); otherwise they stay on the disk. */
  readonly freesFiles: boolean
}

const tagsOf = (torrent: SeedingTorrent) =>
  (torrent.tags ?? "").split(",").map((tag) => tag.trim()).filter((tag) => tag !== "")

/** Whether a rule covers the torrent: true, false, or undefined when Quai can't tell (trackers, privacy unknown). */
const ruleCovers = (rule: SeedingRule, torrent: SeedingTorrent, tags: ReadonlyArray<string>): boolean | undefined => {
  if (!rule.categories.some((category) => sameId(category, torrent.category ?? ""))) return false
  if ((rule.tagsAny ?? []).length > 0 && !rule.tagsAny!.some((wanted) => tags.some((tag) => sameId(tag, wanted)))) {
    return false
  }
  if ((rule.tagsAll ?? []).length > 0 && !rule.tagsAll!.every((wanted) => tags.some((tag) => sameId(tag, wanted)))) {
    return false
  }
  // Quai doesn't read the trackers.
  if ((rule.trackerPatterns ?? []).length > 0) return undefined
  if (rule.privacyType === "Both") return true
  if (torrent.private === undefined || torrent.private === null) return undefined
  return rule.privacyType === "Public" ? !torrent.private : torrent.private
}

/**
 * The rule Cleanuparr applies to the torrent (`SeedingRuleEvaluator`): the first by priority that
 * covers it. None when no rule does, or when one before it may: Quai can't tell which applies.
 */
export const seedingRuleOf = (rules: ReadonlyArray<SeedingRule>, torrent: SeedingTorrent): SeedingRule | undefined => {
  const tags = tagsOf(torrent)
  for (const rule of [...rules].sort((left, right) => left.priority - right.priority)) {
    const covered = ruleCovers(rule, torrent, tags)
    if (covered === undefined) return undefined
    if (covered) return rule
  }
  return undefined
}

/** qBittorrent counts seeding time, and the ratio grows, only while the torrent seeds. */
const isStopped = (torrent: SeedingTorrent) => /^(paused|stopped)/i.test(torrent.state)

/** The qBittorrent client of the download cleaner's settings: the only download client Quai reads. */
const qbittorrentClient = (settings: DownloadCleanerSettings) =>
  settings.clients.find((candidate) =>
    candidate.downloadClientEnabled && sameId(candidate.downloadClientTypeName, "qBittorrent")
  )

/** The download cleaner leaves alone what its ignored list names: a hash, a category or a tag. */
const isIgnoredByDownloadCleaner = (ignored: ReadonlyArray<string>, torrent: SeedingTorrent) =>
  ignored.some((entry) =>
    sameId(entry, torrent.hash) || sameId(entry, torrent.category ?? "") ||
    tagsOf(torrent).some((tag) => sameId(tag, entry))
  )

/** The rule that takes the torrent, when Quai is sure one does: Delete, or Stop on one still seeding. */
const cleaningRule = (rules: ReadonlyArray<SeedingRule>, torrent: SeedingTorrent): SeedingRule | undefined => {
  const rule = seedingRuleOf(rules, torrent)
  if (rule === undefined || (rule.action !== "Delete" && rule.action !== "Stop")) return undefined
  if (rule.action === "Stop" && isStopped(torrent)) return undefined
  return rule
}

/**
 * When the torrent reaches the rule's limits if it keeps seeding: its ratio (once reached, after the
 * minimum seed time) and its maximum seed time. A limit the rule doesn't set has no date.
 */
const limitsDue = (rule: SeedingRule, torrent: SeedingTorrent, now: number) => {
  const byRatio = rule.maxRatio >= 0
  const ratioReached = byRatio && torrent.ratio >= rule.maxRatio
  const afterSeeding = (hours: number) => now + Math.max(0, hours * 3600 - torrent.seeding_time) * 1000
  const ratioDue = ratioReached ? afterSeeding(rule.minSeedTime) : undefined
  const timeDue = rule.maxSeedTime >= 0 ? afterSeeding(rule.maxSeedTime) : undefined
  const due = [ratioDue, timeDue].filter((instant): instant is number => instant !== undefined)
  return { byRatio, ratioReached, due }
}

/** "from" when the rule also waits on seeders or inactivity, "by" while the ratio isn't reached, else "at". */
const cleanupTiming = (rule: SeedingRule, byRatio: boolean, ratioReached: boolean): CleanupTiming => {
  const waits = (rule.minSeeders ?? 0) > 0 || (rule.maxInactiveDays ?? -1) >= 0
  return waits ? "from" : byRatio && !ratioReached ? "by" : "at"
}

const takesAtOnce = (rule: SeedingRule) => rule.maxSeedTime === 0 || (rule.maxRatio === 0 && rule.minSeedTime <= 0)

/**
 * When Cleanuparr's download cleaner takes each finished torrent (`ShouldCleanDownload`): once its
 * ratio is reached (after the minimum seed time), or its maximum seed time, at the first run after
 * that. A torrent it leaves alone (ignored, no rule Quai can be sure of, Stop on a stopped one, a
 * stopped one not due yet) isn't listed. The date assumes the torrent keeps seeding.
 */
export const seedCleanups = <T extends SeedingTorrent>(input: {
  readonly settings: DownloadCleanerSettings
  readonly torrents: ReadonlyArray<T>
  /** Epoch milliseconds of the download cleaner's next run, when scheduled. */
  readonly nextRunAt: number | undefined
  readonly now: number
}): ReadonlyArray<SeedCleanup<T>> => {
  if (!input.settings.enabled) return []
  const client = qbittorrentClient(input.settings)
  if (client === undefined) return []
  const ignored = input.settings.ignoredDownloads ?? []
  const firstRun = (at: number) =>
    input.nextRunAt !== undefined && at <= input.nextRunAt ? input.nextRunAt : Math.max(at, input.now)
  return input.torrents.flatMap((torrent): ReadonlyArray<SeedCleanup<T>> => {
    if (torrent.progress < 1 || isIgnoredByDownloadCleaner(ignored, torrent)) return []
    const rule = cleaningRule(client.seedingRules, torrent)
    if (rule === undefined) return []
    const { byRatio, ratioReached, due } = limitsDue(rule, torrent, input.now)
    // Stopped, it gets no closer to its limits: only what's due already goes.
    if (isStopped(torrent) && !due.some((instant) => instant <= input.now)) return []
    if (due.length === 0 && !byRatio) return []
    return [{
      torrent,
      rule,
      at: due.length === 0 ? undefined : firstRun(Math.min(...due)),
      timing: cleanupTiming(rule, byRatio, ratioReached),
      atOnce: takesAtOnce(rule),
      freesFiles: rule.action === "Delete" && rule.deleteSourceFiles
    }]
  })
}

/** The category Cleanuparr gives torrents no hardlink holds, when it does: their files aren't in the library. */
export const unlinkedCategory = (settings: DownloadCleanerSettings): string | undefined => {
  const config = qbittorrentClient(settings)?.unlinkedConfig
  return config?.enabled === true ? config.targetCategory : undefined
}

// The journal: what Cleanuparr removed.

/** Why Cleanuparr removed a download (`DeleteReason`), in words. */
const removedBecause: Record<string, string> = {
  Stalled: "stalled",
  FailedImport: "its import kept failing",
  DownloadingMetadata: "stuck downloading its metadata",
  SlowSpeed: "too slow",
  SlowTime: "would have taken too long",
  AllFilesSkipped: "every file was skipped",
  AllFilesSkippedByQBit: "qBittorrent skipped every file",
  AllFilesBlocked: "every file is blocked",
  AtLeastOneFileBlocked: "a file is blocked",
  DownloadFailed: "the download failed",
  Errored: "the download client reported an error"
}

/** "Cleanuparr removed Dune.Part.Two.2024.1080p-FLUX from the queue (stalled), and from the download client". */
export const removalNote = (event: RemovalEvent): JournalNote => {
  const title = event.itemTitle ?? "a download"
  const why = removedBecause[event.deleteReason ?? ""]
  return {
    level: "info",
    source: "cleanuparr",
    kind: "cleanuparr.removed",
    text: `Cleanuparr removed ${title} from the queue${why === undefined ? "" : ` (${why})`}${
      event.removeFromClient === true ? ", and from the download client" : ""
    }`,
    ...(event.itemTitle ? { title: event.itemTitle } : {})
  }
}

/** "Cleanuparr took Dune.Part.Two.2024.1080p-FLUX out of qBittorrent after seeding (ratio 2.1, 14 days)". */
export const cleanedNote = (event: CleanedEvent): JournalNote => {
  const title = event.itemTitle ?? "a torrent"
  return {
    level: "info",
    source: "cleanuparr",
    kind: "cleanuparr.cleaned",
    text: `Cleanuparr took ${title} out of qBittorrent after seeding${seededText(event)}`,
    ...(event.itemTitle ? { title: event.itemTitle } : {})
  }
}

/** " (ratio 2.1, 14 days)": what it seeded, as far as Cleanuparr says. */
const seededText = (event: CleanedEvent) => {
  const parts = [
    ...(event.seedRatio === undefined || event.seedRatio === null ? [] : [`ratio ${event.seedRatio.toFixed(1)}`]),
    ...(event.seedingTimeHours === undefined || event.seedingTimeHours === null
      ? []
      : [seedingTimeText(event.seedingTimeHours)])
  ]
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`
}

const seedingTimeText = (hours: number) => {
  if (hours < 48) return `${Math.round(hours)} hours`
  return `${Math.round(hours / 24)} days`
}

/** A removal, gone: "Cleanuparr took it out of the queue: stalled". */
export const removalGone = (event: RemovalEvent, at: number): GoneItem => {
  const why = removedBecause[event.deleteReason ?? ""]
  return goneItem({
    kind: "stuckRemoval",
    source: "cleanuparr",
    at,
    title: event.itemTitle ?? "A download",
    detail: `Cleanuparr took it out of the queue${why === undefined ? "" : `: ${why}`}`
  })
}

/** A seed cleanup, gone: "Cleanuparr took it out of qBittorrent after seeding". */
export const cleanedGone = (event: CleanedEvent, at: number): GoneItem =>
  goneItem({
    kind: "seedCleanup",
    source: "cleanuparr",
    at,
    title: event.itemTitle ?? "A torrent",
    detail: "Cleanuparr took it out of qBittorrent after seeding"
  })

/** Cleanuparr's events are read this often. */
export const removalsEverySeconds = 300

export const removalsWatchId = "cleanuparr:removals"

export const cleanedWatchId = "cleanuparr:cleaned"

/** An event as its feed dates it, never a dry run. */
const dated = <E extends { readonly timestamp: string; readonly isDryRun?: boolean | undefined }>(
  events: ReadonlyArray<E>
) => events.filter((event) => event.isDryRun !== true).map((event) => ({ ...event, at: Date.parse(event.timestamp) }))

/**
 * The removals not logged yet: newer than `after` (epoch milliseconds), not seen before, never a dry
 * run. Oldest first, as they happened.
 */
export const newRemovals = (
  events: ReadonlyArray<RemovalEvent>,
  after: number,
  seen: ReadonlySet<string>
) => unseenSince(dated(events), after, seen)

/**
 * What Cleanuparr did on its own, read every 5 minutes while Quai Home reaches it: the downloads it
 * removed from a queue and the torrents it cleaned after seeding. Each is logged once in the
 * journal, and is gone (a stuck removal, a seed cleanup).
 */
export const cleanuparr = (journal: Journal["Service"]): Integration => {
  const removals = eventFeed(journal, { source: "cleanuparr", kinds: ["cleanuparr.removed"] })
  const cleaned = eventFeed(journal, { source: "cleanuparr", kinds: ["cleanuparr.cleaned"] })
  return {
    service: "cleanuparr",
    goneWatcher: {
      watches: (context) =>
        context.services.includes("cleanuparr")
          ? [
            watchOf(removalsWatchId, removalsRead, removalsEverySeconds),
            watchOf(cleanedWatchId, cleanedRead, removalsEverySeconds)
          ]
          : [],
      read: (snapshot) =>
        Effect.gen(function*() {
          if (snapshot.watch.id === cleanedWatchId) {
            const events = yield* readSnapshot(cleanedRead, snapshot)
            if (Option.isNone(events)) return []
            const fresh = yield* cleaned.fresh(dated(events.value.items))
            yield* Effect.forEach(fresh, (event) => journal.log(cleanedNote(event)), { discard: true })
            return fresh.map((event) => cleanedGone(event, event.at))
          }
          const events = yield* readSnapshot(removalsRead, snapshot)
          if (Option.isNone(events)) return []
          const fresh = yield* removals.fresh(dated(events.value.items))
          yield* Effect.forEach(fresh, (event) => journal.log(removalNote(event)), { discard: true })
          return fresh.map((event) => removalGone(event, event.at))
        })
    },
    actions: {}
  }
}
