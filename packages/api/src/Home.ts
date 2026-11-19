import { Schema } from "effect"

/**
 * The Quai Home ↔ Quai Cloud protocol (docs/spec-v2-hosted.md). The Home runs at home, next to the
 * services, and opens one WebSocket to the Cloud. It holds the services' keys and the home's data;
 * the Cloud holds nothing and works in memory. Messages are JSON text frames. Bump
 * `protocolVersion` on any change an older Home couldn't follow.
 *
 * Opening: Home `Hello` → Cloud `Challenge` → Home `Proof` → Cloud `Welcome` (or `Refused`). Then
 * either side may send anything below; the Cloud pings every 20 s and the Home reconnects after
 * 60 s without one.
 */
export const protocolVersion = 1

/** The services a Home can reach. */
export const HomeService = Schema.Literals(["radarr", "sonarr", "qbittorrent", "jellyfin"])
export type HomeService = typeof HomeService.Type

/** The services whose webhooks the Home receives and forwards. */
export const webhookServices: ReadonlyArray<HomeService> = ["radarr", "sonarr", "jellyfin"]

/** Largest response body the Home forwards; bigger ones come back as a failure. */
export const maxBodyBytes = 1_000_000

// Home → Cloud

export const Hello = Schema.TaggedStruct("Hello", {
  protocol: Schema.Number,
  homeVersion: Schema.String,
  /** The home's Ed25519 public key (SPKI, base64). The home id is its fingerprint. */
  publicKey: Schema.String,
  /** The services this Home has a URL (and key) for. */
  services: Schema.Array(HomeService)
})

/** The Cloud's nonce, signed with the home's private key (Ed25519, base64). */
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

export const HomeMessage = Schema.Union([
  Hello,
  Proof,
  WebhookReceived,
  WatchSnapshot,
  CallResponse,
  Failed,
  StoreDocuments,
  StoreDone,
  Pong
])
export type HomeMessage = typeof HomeMessage.Type

// Cloud → Home

export const Challenge = Schema.TaggedStruct("Challenge", {
  /** Random, base64: the Home signs it to prove it holds the home's key. */
  nonce: Schema.String
})

/** The Cloud accepted the Home. */
export const Welcome = Schema.TaggedStruct("Welcome", {
  homeId: Schema.String
})

/** The Cloud turns the Home away (protocol too old, bad proof): retry after the delay. */
export const Refused = Schema.TaggedStruct("Refused", {
  reason: Schema.String,
  retryAfterSeconds: Schema.Number
})

/** How a request body is sent: JSON, or form-encoded (qBittorrent's writes). */
export const BodyEncoding = Schema.Literals(["json", "form"])

/** One HTTP call to a service, within the allowlist: a button press, or a one-off read. */
export const Call = Schema.TaggedStruct("Call", {
  id: Schema.String,
  service: HomeService,
  method: Schema.Literals(["GET", "POST"]),
  /** Path and query, as the service expects them: `/api/v2/torrents/info?hashes=a|b`. */
  path: Schema.String,
  body: Schema.optionalKey(Schema.Unknown),
  encoding: Schema.optionalKey(BodyEncoding)
})
export type Call = typeof Call.Type

export const Watch = Schema.Struct({
  id: Schema.String,
  service: HomeService,
  /** A GET within the allowlist. */
  path: Schema.String,
  everySeconds: Schema.Number.check(Schema.isBetween({ minimum: 5, maximum: 3600 }))
})
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

export const Ping = Schema.TaggedStruct("Ping", {
  at: Schema.Number
})

export const CloudMessage = Schema.Union([
  Challenge,
  Welcome,
  Refused,
  Call,
  SetWatches,
  StoreList,
  StorePut,
  StoreDelete,
  Ping
])
export type CloudMessage = typeof CloudMessage.Type

/** Keys of home documents: lowercase segments separated by slashes (`flows/download`). */
export const isStoreKey = (key: string) => /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i.test(key) && key.length <= 200

/**
 * What the Cloud may ask a Home to call, per service: method and path pattern (the query is not
 * checked). The reads Quai needs, and the writes the action catalog offers. The Home enforces it:
 * a compromised Cloud can't delete a library or read the services' settings.
 */
export const allowlist: Record<HomeService, ReadonlyArray<{ readonly method: "GET" | "POST"; readonly path: RegExp }>> = {
  radarr: [{ method: "GET", path: /^\/api\/v3\/system\/status$/ }],
  sonarr: [{ method: "GET", path: /^\/api\/v3\/system\/status$/ }],
  qbittorrent: [
    { method: "GET", path: /^\/api\/v2\/app\/version$/ },
    { method: "GET", path: /^\/api\/v2\/torrents\/info$/ }
  ],
  jellyfin: [
    { method: "GET", path: /^\/System\/Info\/Public$/ },
    { method: "GET", path: /^\/Items$/ },
    { method: "GET", path: /^\/Sessions$/ },
    { method: "POST", path: /^\/Sessions\/[\w-]+\/Playing\/(PlayPause|Stop)$/ }
  ]
}

/** Whether the allowlist lets this call through. */
export const allowed = (request: { readonly service: HomeService; readonly method: "GET" | "POST"; readonly path: string }): boolean => {
  const path = request.path.split("?")[0]!
  return !path.includes("..") && allowlist[request.service].some((rule) => rule.method === request.method && rule.path.test(path))
}
