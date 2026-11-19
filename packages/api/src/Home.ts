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
  services: Schema.Array(HomeService)
})

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
  /** 32 random bytes, base64: the Home signs `challengePayload(nonce)` to prove it holds the key. */
  nonce: Schema.String
})

/**
 * What the Home signs for a Challenge. The prefix keeps a challenge signature from ever being
 * reused as another signature made with the same key (the console link, say).
 */
export const challengePayload = (nonce: string) => `quai-challenge:${nonce}`

/** The home id: the fingerprint of its public key (SPKI DER, base64), the first 32 hex chars of its SHA-256. */
export const homeId = (publicKey: string): string => {
  const bytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0))
  return sha256Hex(bytes).slice(0, 32)
}

// SHA-256 (FIPS 180-4) in plain TypeScript: this package is also bundled for the browser (the
// console), where node:crypto doesn't exist and WebCrypto is asynchronous.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const sha256Hex = (message: Uint8Array): string => {
  const length = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(length - 8, Math.floor(message.length / 0x20000000))
  view.setUint32(length - 4, (message.length * 8) >>> 0)
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!
      w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const round = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = h[i]! + round[i]!
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("")
}

/** The Cloud accepted the Home, under the home id it computed from the Hello's public key. */
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

/** `at`: the Cloud's clock, epoch milliseconds; the Home echoes it in Pong to measure the round trip. */
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

/**
 * Keys of home documents: lowercase segments separated by slashes (`flows/download`), lowercase so
 * they can't collide on a case-insensitive disk. A key and a folder may share a name (`flows` and
 * `flows/download`): they are separate documents, and `StoreList("flows")` returns both.
 */
export const isStoreKey = (key: string) => /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(key) && key.length <= 200

/**
 * What the Cloud may ask a Home to call, per service: method and path pattern (the query is not
 * checked). The reads Quai needs, and the writes the action catalog offers. The Home enforces it:
 * a compromised Cloud can't delete a library or read the services' settings.
 */
export const allowlist: Record<HomeService, ReadonlyArray<{ readonly method: "GET" | "POST"; readonly path: RegExp }>> = {
  radarr: [
    { method: "GET", path: /^\/api\/v3\/system\/status$/ },
    { method: "GET", path: /^\/api\/v3\/movie$/ },
    { method: "GET", path: /^\/api\/v3\/diskspace$/ }
  ],
  sonarr: [
    { method: "GET", path: /^\/api\/v3\/system\/status$/ },
    { method: "GET", path: /^\/api\/v3\/series$/ },
    { method: "GET", path: /^\/api\/v3\/diskspace$/ }
  ],
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
