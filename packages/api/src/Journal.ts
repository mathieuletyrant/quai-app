import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth } from "./Devices.ts"
import { Service } from "./Service.ts"

/**
 * The journal: what Quai did, in plain words, one line per thing. Quai Cloud writes most of it,
 * Quai Home the rest (the webhooks it took in, what its allowlist refused); Quai Home keeps it on
 * its `/data`, so it outlives a Cloud restart. Never a secret or a token: titles, names and what
 * happened only, the home's own data, kept at home.
 */

export const JournalLevel = Schema.Literals(["info", "warn", "error"]).annotate({ identifier: "JournalLevel" })
export type JournalLevel = typeof JournalLevel.Type

/** Where a line comes from: a service, Apple (pushes), Quai Home or Quai Cloud itself. */
export const JournalSource = Schema.Literals([
  ...Service.pick(["radarr", "sonarr", "prowlarr", "qbittorrent", "jellyfin", "seerr", "reclaimerr", "cleanuparr"]).literals,
  "apple",
  "home",
  "cloud"
])
  .annotate({ identifier: "JournalSource" })
export type JournalSource = typeof JournalSource.Type
export const journalSources: ReadonlyArray<JournalSource> = JournalSource.literals

/** A source as the journal names it. */
export const journalSourceNames: Record<JournalSource, string> = {
  radarr: "Radarr",
  sonarr: "Sonarr",
  prowlarr: "Prowlarr",
  qbittorrent: "qBittorrent",
  jellyfin: "Jellyfin",
  seerr: "Seerr",
  reclaimerr: "Reclaimerr",
  cleanuparr: "Cleanuparr",
  apple: "Apple",
  home: "Quai Home",
  cloud: "Quai Cloud"
}

export const JournalEntry = Schema.Struct({
  /** `journalId`: sorts as the entries happened. */
  id: Schema.String,
  /** Epoch milliseconds. */
  at: Schema.Finite,
  level: JournalLevel,
  source: JournalSource,
  /** A short code of what happened: `media.grabbed`, `push.refused`, `home.offline`. */
  kind: Schema.String,
  /** One plain line: "Radarr grabbed Dune (2021)". */
  text: Schema.String,
  /** The title it is about, by key (`movie:tmdb:438631`): every line of one title shares it. */
  subject: Schema.optionalKey(Schema.String),
  /** That title, as shown. */
  title: Schema.optionalKey(Schema.String),
  flowId: Schema.optionalKey(Schema.String),
  /** The iPhone it went to, or that pressed the button. */
  deviceName: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "JournalEntry" })
export type JournalEntry = typeof JournalEntry.Type

/** An entry before it is written: its id and time are given by the journal. */
export type JournalNote = Omit<JournalEntry, "id" | "at">

/** Who wrote an entry, in its id: Quai Cloud or Quai Home. */
export type JournalOrigin = "c" | "h"

/**
 * An entry's id: its time, then who wrote it and a counter, so that ids sort as the entries
 * happened and two writers never mint the same one.
 */
export const journalId = (at: number, origin: JournalOrigin, counter: number) =>
  `${String(Math.max(0, Math.floor(at))).padStart(13, "0")}-${origin}${counter.toString(36).padStart(6, "0")}`

/** A page asked for at most this many entries. */
export const maxJournalPage = 200
export const defaultJournalPage = 100

const levelRank: Record<JournalLevel, number> = { info: 0, warn: 1, error: 2 }

/** Which entries a page holds: older than `before` (an id), and only these sources, this level and up, this title, these words. */
export const JournalQuery = Schema.Struct({
  before: Schema.optionalKey(Schema.String),
  limit: Schema.Number,
  sources: Schema.optionalKey(Schema.Array(JournalSource)),
  /** This level and the ones above: `warn` is warnings and errors. */
  level: Schema.optionalKey(JournalLevel),
  subject: Schema.optionalKey(Schema.String),
  /** Words in the text or the title, any case. */
  search: Schema.optionalKey(Schema.String),
  /** Only these kinds (`media.grabbed`). */
  kinds: Schema.optionalKey(Schema.Array(Schema.String))
}).annotate({ identifier: "JournalQuery" })
export type JournalQuery = typeof JournalQuery.Type

/** Whether an entry passes a query's filters (not its paging). */
export const journalMatches = (entry: JournalEntry, query: Omit<JournalQuery, "before" | "limit">): boolean => {
  if (query.sources !== undefined && query.sources.length > 0 && !query.sources.includes(entry.source)) return false
  if (query.level !== undefined && levelRank[entry.level] < levelRank[query.level]) return false
  if (query.subject !== undefined && entry.subject !== query.subject) return false
  if (query.kinds !== undefined && !query.kinds.includes(entry.kind)) return false
  const search = query.search?.trim().toLowerCase() ?? ""
  if (search !== "" && !`${entry.text} ${entry.title ?? ""} ${entry.deviceName ?? ""}`.toLowerCase().includes(search)) return false
  return true
}

/**
 * One page of entries, newest first: those older than `before` that pass the filters, at most
 * `limit` (1 to `maxJournalPage`), and whether older ones remain.
 */
export const journalPage = (entries: ReadonlyArray<JournalEntry>, query: JournalQuery) => {
  const limit = Math.min(maxJournalPage, Math.max(1, Math.floor(query.limit)))
  const matching = entries
    .filter((entry) => (query.before === undefined || entry.id < query.before) && journalMatches(entry, query))
    .sort((left, right) => left.id < right.id ? 1 : left.id > right.id ? -1 : 0)
  return { entries: matching.slice(0, limit), more: matching.length > limit }
}

/**
 * Where a page came from: `home`, the history Quai Home keeps (7 days); `memory`, the last lines
 * Quai Cloud holds, while Quai Home is offline or too old to keep a journal.
 */
export const JournalKept = Schema.Literals(["home", "memory"]).annotate({ identifier: "JournalKept" })

export const JournalPage = Schema.Struct({
  /** Newest first. */
  entries: Schema.Array(JournalEntry),
  /** Older entries remain: ask again with `before` the last id. */
  more: Schema.Boolean,
  kept: JournalKept
}).annotate({ identifier: "JournalPage" })
export type JournalPage = typeof JournalPage.Type

/** What happened since a cursor, for the live view. */
export const JournalTail = Schema.Struct({
  /** Oldest first, as they came in. */
  entries: Schema.Array(JournalEntry),
  /** Pass it back to get only what comes after. */
  cursor: Schema.String
}).annotate({ identifier: "JournalTail" })
export type JournalTail = typeof JournalTail.Type

/** The console's Journal page. Never behind `HomeRequired`: what Quai Cloud holds still shows while Quai Home is offline. */
export class ConsoleJournalGroup extends HttpApiGroup.make("consoleJournal")
  .add(
    HttpApiEndpoint.get("history", "/journal", {
      query: {
        /** An entry id: entries older than it. */
        before: Schema.optionalKey(Schema.String),
        limit: Schema.optionalKey(Schema.FiniteFromString),
        /** Comma-separated sources: `radarr,sonarr`. */
        source: Schema.optionalKey(Schema.String),
        level: Schema.optionalKey(JournalLevel),
        subject: Schema.optionalKey(Schema.String),
        search: Schema.optionalKey(Schema.String)
      },
      success: JournalPage
    }).annotate(OpenApi.Identifier, "consoleJournalHistory"),
    HttpApiEndpoint.get("since", "/journal/since", {
      query: { cursor: Schema.optionalKey(Schema.String) },
      success: JournalTail
    }).annotate(OpenApi.Identifier, "consoleJournalSince")
  )
  .prefix("/console-api") {}

/**
 * What the app's journal shows: what happened to the titles, the requests and the server, not
 * Quai's own plumbing (webhooks, pushes, watches, activities).
 */
export const appJournalKinds: ReadonlyArray<string> = [
  "media.added",
  "media.grabbed",
  "media.imported",
  "media.importBlocked",
  "media.available",
  "download.removed",
  "playback.started",
  "playback.stopped",
  "alert.raised",
  "alert.over",
  "request.created",
  "request.pending",
  "request.approved",
  "request.declined",
  "releases.available"
]

/** The app's journal: the Home's recent entries and the Activity tab's history, a page at a time. */
export class JournalGroup extends HttpApiGroup.make("journal")
  .add(
    HttpApiEndpoint.get("recent", "/journal", {
      query: {
        /** An entry id: entries older than it. */
        before: Schema.optionalKey(Schema.String),
        limit: Schema.optionalKey(Schema.FiniteFromString)
      },
      success: JournalPage
    }).annotate(OpenApi.Identifier, "listJournal")
  )
  .middleware(DeviceAuth)
  .prefix("/api") {}
