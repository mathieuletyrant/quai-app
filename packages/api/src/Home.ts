import { Schema } from "effect"
import { JournalEntry, JournalQuery } from "./Journal.ts"
import { Service } from "./Service.ts"
import type { TitleKind } from "./Title.ts"

/**
 * The Quai Home ↔ Quai Cloud protocol (docs/spec-v2-hosted.md). The Home runs at home, next to the
 * services, and opens one WebSocket to the Cloud. It holds the services' keys and the home's data;
 * the Cloud holds nothing and works in memory. Messages are JSON text frames. Bump
 * `protocolVersion` on any change an older Home couldn't follow; the Cloud keeps accepting Homes
 * down to `minProtocolVersion`.
 *
 * Opening: Home `Hello` → Cloud `Challenge` → Home `Proof` → Cloud `Welcome` (or `Refused`). Then
 * either side may send anything below; the Cloud pings every 20 s and the Home reconnects after
 * 60 s without one.
 */
export const protocolVersion = 11

/**
 * The oldest Home the Cloud still serves. Protocol 2 added Reclaimerr, `DELETE` calls and body
 * checks; protocol 3 added Seerr and the *arr calendars. An older Home refuses those calls as not
 * allowed, so what needs them stays empty. Protocol 4 added the journal (`JournalAppend`,
 * `JournalRead`): the Cloud sends them only to a Home at `journalProtocolVersion` or later, and
 * keeps the journal in memory only for an older one. Protocol 5 added Cleanuparr and `PUT`, a write
 * the Home checks against what the service holds (`AllowRule.against`); an older Home doesn't list
 * Cleanuparr, so nothing asks it for them. Protocol 6 added Prowlarr and the *arr health checks
 * (`/api/v3/health`), for the alerts: an older Home refuses the health watch, so that alert stays
 * quiet, and doesn't list Prowlarr. Protocol 7 added the console relay (`ConsoleRequest`, answered
 * `ConsoleResponse`) and `ServicesChanged`: the console is served by Quai Home, and an older Home
 * sends neither, so its console is the one the Cloud no longer serves. Protocol 8 added Seerr's
 * search, its users and creating a request: the Cloud doesn't ask an older Home for them
 * (`searchProtocolVersion`), and the app says to update it. Protocol 9 added, for Upcoming, Cleanuparr's
 * download cleaner (its rules and next run) and Radarr's and Sonarr's media management setting
 * (hardlinks or copies): the Cloud doesn't ask an older Home for them (`upcomingProtocolVersion`), and
 * Upcoming shows no seed cleanup and no space coming back. Protocol 10 added Reclaimerr's event feed,
 * for what is gone: the Cloud doesn't watch it on an older Home (`goneProtocolVersion`), so Gone ·
 * Planned deletion stays quiet there. Protocol 11 added Reclaimerr's deletion task (when it runs): an
 * older Home refuses it, and a planned deletion then shows the day its delay ends, at the earliest.
 */
export const minProtocolVersion = 1

/** The first protocol whose Home keeps the journal. */
export const journalProtocolVersion = 4

/** The first protocol whose Home allows the *arr health checks and Prowlarr. */
export const arrHealthProtocolVersion = 6

/** The first protocol whose Home serves the console and relays its requests. */
export const consoleProtocolVersion = 7

/** The first protocol whose Home allows Seerr's search, its users and creating a request. */
export const searchProtocolVersion = 8

/** The first protocol whose Home allows the download cleaner's rules and the *arr media management setting. */
export const upcomingProtocolVersion = 9

/** The first protocol whose Home allows Reclaimerr's event feed (what it deleted or moved). */
export const goneProtocolVersion = 10

/** The services a Home can reach. */
export const HomeService = Service
export type HomeService = Service

/** The services whose webhooks the Home receives and forwards. Jellyfin is polled (its sessions). */
export const webhookServices: ReadonlyArray<HomeService> = ["radarr", "sonarr", "seerr"]

/**
 * Largest response body the Home forwards; bigger ones come back as a failure. Sized for the
 * library lists: Radarr's `/api/v3/movie` runs to a few kilobytes per title.
 */
export const maxBodyBytes = 16_000_000

// Home → Cloud

export const Hello = Schema.TaggedStruct("Hello", {
  protocol: Schema.Number,
  homeVersion: Schema.String,
  /** The home's Ed25519 public key (SPKI, base64). The home id is its fingerprint. */
  publicKey: Schema.String,
  /** The services this Home has a URL (and key) for. */
  services: Schema.Array(HomeService),
  /**
   * Where an iPhone opens Radarr's and Sonarr's own pages, at home first, then from outside: the
   * app's links to a title. Optional: a Home without them sends none, and the app shows no link.
   */
  webUrls: Schema.optionalKey(Schema.Struct({
    radarr: Schema.optionalKey(Schema.Array(Schema.String)),
    sonarr: Schema.optionalKey(Schema.Array(Schema.String))
  }))
})
export type WebUrls = NonNullable<typeof Hello.Type["webUrls"]>

/** `challengePayload(nonce)` signed with the home's private key (Ed25519, base64). */
export const Proof = Schema.TaggedStruct("Proof", {
  signature: Schema.String
})

export const WebhookReceived = Schema.TaggedStruct("WebhookReceived", {
  service: HomeService,
  /** Epoch milliseconds on the Home, to order it against polled snapshots. */
  receivedAt: Schema.Number,
  body: Schema.Unknown
})

/** A watched resource changed (or was read for the first time since the watch was set). */
export const WatchSnapshot = Schema.TaggedStruct("WatchSnapshot", {
  watchId: Schema.String,
  status: Schema.Number,
  body: Schema.String
})

export const CallResponse = Schema.TaggedStruct("CallResponse", {
  id: Schema.String,
  status: Schema.Number,
  body: Schema.String
})

/** A call, a watch or a store operation failed: refused by the allowlist, unreachable, too large… */
export const Failed = Schema.TaggedStruct("Failed", {
  id: Schema.String,
  reason: Schema.String
})

/** The documents under a prefix, answering `StoreList`. */
export const StoreDocuments = Schema.TaggedStruct("StoreDocuments", {
  id: Schema.String,
  documents: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Unknown }))
})

/** A `StorePut` or `StoreDelete` is on disk. */
export const StoreDone = Schema.TaggedStruct("StoreDone", {
  id: Schema.String
})

export const Pong = Schema.TaggedStruct("Pong", {
  at: Schema.Number
})

/** A page of the journal, answering `JournalRead`. */
export const JournalPage = Schema.TaggedStruct("JournalPage", {
  id: Schema.String,
  /** Newest first. */
  entries: Schema.Array(JournalEntry),
  more: Schema.Boolean
})

/** Lines the Home wrote to its journal itself (a webhook in, a call refused), for the Cloud's live view. */
export const JournalNoted = Schema.TaggedStruct("JournalNoted", {
  entries: Schema.Array(JournalEntry)
})

/**
 * A request of the console, which Quai Home serves: the Cloud answers it with `ConsoleResponse`, as
 * its own `/console-api` route would. Only `isConsolePath` paths: the Cloud refuses any other.
 */
export const ConsoleRequest = Schema.TaggedStruct("ConsoleRequest", {
  id: Schema.String,
  method: Schema.Literals(["GET", "POST", "PUT", "DELETE"]),
  /** Path and query: `/console-api/journal?limit=50`. */
  path: Schema.String,
  /** JSON, as the console sent it. */
  body: Schema.optionalKey(Schema.String)
})
export type ConsoleRequest = typeof ConsoleRequest.Type

/** The services Quai Home reaches changed (set or removed from the console's Services page). */
export const ServicesChanged = Schema.TaggedStruct("ServicesChanged", {
  services: Schema.Array(HomeService)
})

export const HomeMessage = Schema.Union([
  Hello,
  Proof,
  WebhookReceived,
  WatchSnapshot,
  CallResponse,
  Failed,
  StoreDocuments,
  StoreDone,
  Pong,
  JournalPage,
  JournalNoted,
  ConsoleRequest,
  ServicesChanged
])
export type HomeMessage = typeof HomeMessage.Type

// Cloud → Home

export const Challenge = Schema.TaggedStruct("Challenge", {
  /** 32 random bytes, base64: the Home signs `challengePayload(nonce)` to prove it holds the key. */
  nonce: Schema.String
})

/**
 * What the Home signs for a Challenge. The prefix keeps a challenge signature from ever being
 * reused as another signature made with the same key (the console link, say).
 */
export const challengePayload = (nonce: string) => `quai-challenge:${nonce}`

/** The Cloud accepted the Home, under the home id it computed from the Hello's public key. */
export const Welcome = Schema.TaggedStruct("Welcome", {
  homeId: Schema.String
})

/** The Cloud turns the Home away (protocol too old, bad proof): retry after the delay. */
export const Refused = Schema.TaggedStruct("Refused", {
  reason: Schema.String,
  retryAfterSeconds: Schema.Number
})

export const CallMethod = Schema.Literals(["GET", "POST", "PUT", "DELETE"])
export type CallMethod = typeof CallMethod.Type

/** One HTTP call to a service, within the allowlist: a button press, or a one-off read. */
export const Call = Schema.TaggedStruct("Call", {
  id: Schema.String,
  service: HomeService,
  method: CallMethod,
  /** Path and query, as the service expects them: `/api/v2/torrents/info?hashes=a|b`. */
  path: Schema.String,
  /** Sent as JSON. */
  body: Schema.optionalKey(Schema.Unknown)
})
export type Call = typeof Call.Type

export const Watch = Schema.Struct({
  id: Schema.String,
  service: HomeService,
  /** A GET within the allowlist. */
  path: Schema.String,
  /** Between `minWatchSeconds` and `maxWatchSeconds`; the Home answers Failed for any other. */
  everySeconds: Schema.Number
})

export const minWatchSeconds = 5
export const maxWatchSeconds = 3600
export type Watch = typeof Watch.Type

/** Replaces every watch: the Home polls these, and only these, until the next `SetWatches`. */
export const SetWatches = Schema.TaggedStruct("SetWatches", {
  watches: Schema.Array(Watch)
})

/** Reads every home document whose key starts with `prefix` ("" for all). */
export const StoreList = Schema.TaggedStruct("StoreList", {
  id: Schema.String,
  prefix: Schema.String
})

export const StorePut = Schema.TaggedStruct("StorePut", {
  id: Schema.String,
  key: Schema.String,
  value: Schema.Unknown
})

export const StoreDelete = Schema.TaggedStruct("StoreDelete", {
  id: Schema.String,
  key: Schema.String
})

/**
 * Lines for the Home to add to its journal. Not answered: the Cloud sends them in batches, every
 * second or two, and a batch lost with the link is only missing from the history.
 */
export const JournalAppend = Schema.TaggedStruct("JournalAppend", {
  entries: Schema.Array(JournalEntry)
})

/** Reads a page of the journal: answered with `JournalPage` (or `Failed`). */
export const JournalRead = Schema.TaggedStruct("JournalRead", {
  id: Schema.String,
  query: JournalQuery
})

/** `at`: the Cloud's clock, epoch milliseconds; the Home echoes it in Pong to measure the round trip. */
export const Ping = Schema.TaggedStruct("Ping", {
  at: Schema.Number
})

/** The answer to a `ConsoleRequest`: the status and JSON body the route answered. */
export const ConsoleResponse = Schema.TaggedStruct("ConsoleResponse", {
  id: Schema.String,
  status: Schema.Number,
  body: Schema.String
})
export type ConsoleResponse = typeof ConsoleResponse.Type

/** What the console asks the Cloud for, through Quai Home: its `/console-api` routes and its health. */
export const isConsolePath = (path: string) => {
  const route = path.split("?")[0]!
  return !route.includes("..") && (route.startsWith("/console-api/") || route === "/api/health")
}

export const CloudMessage = Schema.Union([
  Challenge,
  Welcome,
  Refused,
  Call,
  SetWatches,
  StoreList,
  StorePut,
  StoreDelete,
  JournalAppend,
  JournalRead,
  Ping,
  ConsoleResponse
])
export type CloudMessage = typeof CloudMessage.Type

/**
 * Keys of home documents: lowercase segments separated by slashes (`flows/download`), lowercase so
 * they can't collide on a case-insensitive disk. A key and a folder may share a name (`flows` and
 * `flows/download`): they are separate documents, and `StoreList("flows")` returns both.
 */
export const isStoreKey = (key: string) =>
  /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(key) && key.length <= 200

/** One allowlisted endpoint of a service. */
export interface AllowRule {
  readonly method: CallMethod
  /** Matched against the path without its query (the query is not checked). */
  readonly path: RegExp
  /**
   * A write whose path alone would open too much (`POST /api/v3/command` runs any command): the
   * body must pass this too (it gets `undefined` when there is none). Without it, the rule takes
   * no body.
   */
  readonly body?: (body: unknown) => boolean
  /**
   * A write that replaces a whole document of the service (Cleanuparr's settings take no partial
   * update): the Home first GETs `path`, and sends the write only when `check(current, body)`
   * passes, so the Cloud can change the one field it may change and nothing else. What it read
   * not being JSON is a refusal too.
   */
  readonly against?: { readonly path: string; readonly check: (current: unknown, body: unknown) => boolean }
  /** How long the Home waits for the service: 10 s unless the endpoint is known to be slow. */
  readonly timeoutSeconds?: number
}

/** The Home waits this long for a service, unless the rule says otherwise. */
export const defaultCallTimeoutSeconds = 10

/**
 * A write checked against what the service holds, from the wait for the one before it to its
 * answer: the read, the check and the write together, under the Cloud's 15 s wait for a call, so a
 * write never lands after the Cloud gave up on it.
 */
export const checkedWriteTimeoutSeconds = 12

/** An interactive release search asks every indexer: it takes much longer than a read. */
export const releaseSearchTimeoutSeconds = 50

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A JSON object with only these keys, each passing its check. Keys left out of `optional` are required. */
const shape = (
  required: Record<string, (value: unknown) => boolean>,
  optional: Record<string, (value: unknown) => boolean> = {}
) =>
(body: unknown): boolean =>
  isRecord(body) &&
  Object.keys(body).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)) &&
  Object.entries(required).every(([key, check]) => Object.hasOwn(body, key) && check(body[key])) &&
  Object.entries(optional).every(([key, check]) => !Object.hasOwn(body, key) || check(body[key]))

const isString = (value: unknown) => typeof value === "string"
const isId = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0
const isIds = (value: unknown) => Array.isArray(value) && value.every(isId)
const isAny = () => true

/** The same JSON value: what two answers parsed from JSON hold, keys in any order. */
const sameJson = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
}

/**
 * A download as Radarr and Sonarr name it, and Cleanuparr after them: a torrent's info hash, or
 * SABnzbd's job id. Never a category, a tag or a tracker, which Cleanuparr's ignore list also takes
 * and which would spare every download they cover.
 */
export const isDownloadId = (value: unknown) =>
  typeof value === "string" && (/^[0-9a-fA-F]{40}$/.test(value) || /^SABnzbd_nzo_[A-Za-z0-9_]{1,80}$/.test(value))

const isStrings = (value: unknown): value is ReadonlyArray<string> => Array.isArray(value) && value.every(isString)

/**
 * Cleanuparr's queue cleaner settings, sent back as they are with one more download in
 * `ignoredDownloads`: a download id it didn't list yet. Every other setting must be what Cleanuparr
 * holds now, so the Cloud can't turn the cleaner off, change its schedule or its strikes.
 */
export const ignoresOneMoreDownload = (current: unknown, body: unknown): boolean => {
  if (!isRecord(current) || !isRecord(body)) return false
  // Cleanuparr may answer null for an empty list.
  const before = current.ignoredDownloads === null ? [] : current.ignoredDownloads
  const after = body.ignoredDownloads
  if (!isStrings(before) || !isStrings(after)) return false
  const added = after.at(-1)
  return after.length === before.length + 1 &&
    before.every((entry, index) => after[index] === entry) &&
    isDownloadId(added) &&
    !before.some((entry) => entry.toLowerCase() === added!.toLowerCase()) &&
    sameJson({ ...current, ignoredDownloads: null }, { ...body, ignoredDownloads: null })
}

/** Grabbing one release from the last search: its guid and indexer, nothing else. */
const grabBody = shape({ guid: isString, indexerId: isId })

/**
 * The one command Quai runs: `ManualImport` of a finished download's files, in "auto" mode (move
 * or copy as the download client allows). Every other command (a library rescan, a backup, a
 * search of every title) is refused.
 */
const manualImportBody = (media: TitleKind) =>
  shape({
    name: (value) => value === "ManualImport",
    importMode: (value) => value === "auto",
    files: (value) =>
      Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(shape(
        {
          path: isString,
          downloadId: isString,
          ...(media === "movie" ? { movieId: isId } : { seriesId: isId, episodeIds: isIds })
        },
        {
          ...(media === "series" ? { seasonNumber: (value: unknown) => typeof value === "number" } : {}),
          quality: isAny,
          languages: isAny,
          releaseGroup: isString,
          indexerFlags: isAny
        }
      ))
  })

const isSeasons = (value: unknown) =>
  Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(isId) &&
  new Set(value).size === value.length

/**
 * A request Quai makes in Seerr: a movie, or some seasons of a series (never `"all"`, which would
 * also take the seasons not out yet), by TMDB id, optionally for another user. Nothing else: no
 * server, profile, root folder or 4K, which Seerr picks.
 */
export const requestBody = (body: unknown): boolean =>
  isRecord(body) && (body.mediaType === "movie"
    ? shape({ mediaType: isAny, mediaId: isId }, { userId: isId })(body)
    : body.mediaType === "tv" && shape({ mediaType: isAny, mediaId: isId, seasons: isSeasons }, { userId: isId })(body))

/** What both *arr allow for the To fix list: the queue, what's missing, the grabs, releases and imports. */
const arrFixes = (media: TitleKind): ReadonlyArray<AllowRule> => [
  { method: "GET", path: /^\/api\/v3\/queue$/ },
  { method: "DELETE", path: /^\/api\/v3\/queue\/\d+$/ },
  { method: "GET", path: /^\/api\/v3\/wanted\/missing$/ },
  { method: "GET", path: /^\/api\/v3\/history\/since$/ },
  { method: "GET", path: /^\/api\/v3\/release$/, timeoutSeconds: releaseSearchTimeoutSeconds },
  { method: "POST", path: /^\/api\/v3\/release$/, body: grabBody },
  { method: "GET", path: /^\/api\/v3\/manualimport$/ },
  { method: "POST", path: /^\/api\/v3\/command$/, body: manualImportBody(media) }
]

/**
 * What the Cloud may ask a Home to call, per service: method, path pattern (the query is not
 * checked) and, for the writes that need it, a check of the body. The reads Quai needs, and the
 * writes the action catalog and the To fix list offer. The Home enforces it: a compromised Cloud
 * can't delete a library, run arbitrary commands or read the services' settings.
 */
export const allowlist: Record<HomeService, ReadonlyArray<AllowRule>> = {
  radarr: [
    { method: "GET", path: /^\/api\/v3\/system\/status$/ },
    { method: "GET", path: /^\/api\/v3\/movie$/ },
    { method: "GET", path: /^\/api\/v3\/calendar$/ },
    { method: "GET", path: /^\/api\/v3\/diskspace$/ },
    { method: "GET", path: /^\/api\/v3\/health$/ },
    // Whether imports are hardlinks or copies, for the space Upcoming says comes back. No secret in it.
    { method: "GET", path: /^\/api\/v3\/config\/mediamanagement$/ },
    ...arrFixes("movie")
  ],
  sonarr: [
    { method: "GET", path: /^\/api\/v3\/system\/status$/ },
    { method: "GET", path: /^\/api\/v3\/series$/ },
    { method: "GET", path: /^\/api\/v3\/calendar$/ },
    { method: "GET", path: /^\/api\/v3\/diskspace$/ },
    { method: "GET", path: /^\/api\/v3\/episode$/ },
    { method: "GET", path: /^\/api\/v3\/health$/ },
    { method: "GET", path: /^\/api\/v3\/config\/mediamanagement$/ },
    ...arrFixes("series")
  ],
  prowlarr: [
    { method: "GET", path: /^\/api\/v1\/system\/status$/ },
    { method: "GET", path: /^\/api\/v1\/health$/ }
  ],
  qbittorrent: [
    { method: "GET", path: /^\/api\/v2\/app\/version$/ },
    { method: "GET", path: /^\/api\/v2\/torrents\/info$/ }
  ],
  jellyfin: [
    { method: "GET", path: /^\/System\/Info\/Public$/ },
    { method: "GET", path: /^\/Items$/ },
    // Whose library to list: without a user, Jellyfin lists only part of it.
    { method: "GET", path: /^\/Users$/ },
    { method: "GET", path: /^\/Sessions$/ },
    // The remote commands take no meaningful body: whatever comes is passed on.
    { method: "POST", path: /^\/Sessions\/[\w-]+\/Playing\/(PlayPause|Stop)$/, body: isAny }
  ],
  // Reclaimerr's external API (`/api/v1`, scoped bearer token): its status, the cleanup
  // candidates, protecting one of them for good, its event feed (what it deleted or moved), and its
  // deletion task (when it runs; never running it).
  reclaimerr: [
    { method: "GET", path: /^\/api\/v1\/system$/ },
    { method: "GET", path: /^\/api\/v1\/candidates$/ },
    { method: "GET", path: /^\/api\/v1\/events$/ },
    { method: "GET", path: /^\/api\/v1\/tasks\/delete_cleanup_candidates$/ },
    { method: "POST", path: /^\/api\/v1\/candidates\/\d+\/protect$/, body: shape({}, { reason: isString }) }
  ],
  // Seerr (Jellyseerr, Overseerr): its status, the requests and the titles they ask for,
  // approving or declining one request, searching for a title, its users (who an iPhone requests
  // as), and requesting a movie or some seasons of a series (`requestBody`). Never editing or
  // deleting a request, and never its settings: Quai Home sets up Seerr's webhook itself, at
  // start, outside this list.
  seerr: [
    { method: "GET", path: /^\/api\/v1\/status$/ },
    { method: "GET", path: /^\/api\/v1\/request$/ },
    { method: "GET", path: /^\/api\/v1\/request\/\d+$/ },
    { method: "POST", path: /^\/api\/v1\/request\/\d+\/(approve|decline)$/ },
    // Seerr reads the title from TMDB, and sends an auto-approved request to Radarr or Sonarr, before answering.
    {
      method: "POST",
      path: /^\/api\/v1\/request$/,
      body: (body) => requestBody(body),
      timeoutSeconds: checkedWriteTimeoutSeconds
    },
    { method: "GET", path: /^\/api\/v1\/search$/ },
    { method: "GET", path: /^\/api\/v1\/user$/ },
    { method: "GET", path: /^\/api\/v1\/movie\/\d+$/ },
    { method: "GET", path: /^\/api\/v1\/tv\/\d+$/ }
  ],
  // Cleanuparr (X-Api-Key): its health, the downloads with strikes, the queue cleaner's settings
  // and rules (strike limits and schedule, no secret in them), the download cleaner's seeding
  // rules (no secret either), both jobs' next run, the events (what it
  // removed), and excluding one download from the queue cleaner. Its settings take no partial
  // update: the exclusion sends them all back, and the Home checks that only the ignore list
  // grew, by one download id.
  cleanuparr: [
    { method: "GET", path: /^\/health$/ },
    { method: "GET", path: /^\/api\/strikes$/ },
    { method: "GET", path: /^\/api\/configuration\/queue_cleaner$/ },
    { method: "GET", path: /^\/api\/queue-rules\/(stall|slow)$/ },
    { method: "GET", path: /^\/api\/jobs\/(QueueCleaner|DownloadCleaner)$/ },
    { method: "GET", path: /^\/api\/configuration\/download_cleaner$/ },
    { method: "GET", path: /^\/api\/events$/ },
    {
      method: "PUT",
      path: /^\/api\/configuration\/queue_cleaner$/,
      body: (body) => isRecord(body) && isStrings(body.ignoredDownloads),
      against: { path: "/api/configuration/queue_cleaner", check: ignoresOneMoreDownload }
    }
  ]
}

/** The rule that lets this call through, if any. */
export const allowRule = (request: {
  readonly service: HomeService
  readonly method: CallMethod
  readonly path: string
  readonly body?: unknown
}): AllowRule | undefined => {
  const path = request.path.split("?")[0]!
  if (path.includes("..")) return undefined
  return allowlist[request.service].find((rule) =>
    rule.method === request.method && rule.path.test(path) &&
    (rule.body === undefined ? request.body === undefined : rule.body(request.body)) &&
    // A write checked against a document goes to that document exactly: no query to change its meaning.
    (rule.against === undefined || request.path === rule.against.path)
  )
}

/** Whether the allowlist lets this call through. */
export const allowed = (request: Parameters<typeof allowRule>[0]): boolean => allowRule(request) !== undefined
