import { Schema } from "effect"
import { signatureHeaders } from "./RequestSignature.ts"
import { Service } from "./Service.ts"

/**
 * The Quai Home ↔ Quai Cloud protocol (docs/spec-v2-hosted.md). Quai Home runs Quai for its home,
 * next to the services, and opens one WebSocket to the Cloud ([ADR 3](../../../docs/adr/0003-quai-home-runs-quai.md)).
 * Over it the Cloud only relays the app's requests to the home (`AppRequest`, answered
 * `AppResponse`) and sends the pushes it asks for with the APNs key (`PushRequest`, answered
 * `PushResponse`); the home tells it its open pairing codes' hashes (`PairingCodes`), so a pairing
 * finds its home. The Cloud asks a home for nothing else. Messages are JSON text frames. Bump
 * `protocolVersion` on any change the other side couldn't follow; the Cloud accepts Homes down to
 * `minProtocolVersion`.
 *
 * Opening: Home `Hello` → Cloud `Challenge` → Home `Proof` → Cloud `Welcome` (or `Refused`). Then
 * either side may send anything below; the Cloud pings every 20 s and the Home reconnects after
 * 60 s without one.
 */
export const protocolVersion = 14

/**
 * The oldest Home the Cloud serves. Protocol 13 is the first Home that runs Quai itself; it still
 * sends what the Cloud no longer reads (its services in `Hello`, `ServicesChanged`), which the
 * Cloud leaves. Protocol 14 sends none of it.
 */
export const minProtocolVersion = 13

/** The services a Home can reach. */
export const HomeService = Service
export type HomeService = Service

// Home → Cloud

export const Hello = Schema.TaggedStruct("Hello", {
  protocol: Schema.Number,
  homeVersion: Schema.String,
  /** The home's Ed25519 public key (SPKI, base64). The home id is its fingerprint. */
  publicKey: Schema.String
})

/** `challengePayload(nonce)` signed with the home's private key (Ed25519, base64). */
export const Proof = Schema.TaggedStruct("Proof", {
  signature: Schema.String
})

export const Pong = Schema.TaggedStruct("Pong", {
  at: Schema.Number
})

/**
 * The answer to an `AppRequest`: what the home's own route answered. `contentType` when there is a
 * body and it isn't JSON.
 */
export const AppResponse = Schema.TaggedStruct("AppResponse", {
  id: Schema.String,
  status: Schema.Number,
  contentType: Schema.optionalKey(Schema.String),
  body: Schema.String
})
export type AppResponse = typeof AppResponse.Type

/**
 * One push for the Cloud to send to APNs with its key: a Live Activity update or a notification,
 * built by the Home, to one iPhone's token. Answered with `PushResponse`. The topic is the Cloud's:
 * a Home can only push to the Quai app.
 */
export const PushRequest = Schema.TaggedStruct("PushRequest", {
  id: Schema.String,
  /** Absent: a Live Activity. */
  pushType: Schema.optionalKey(Schema.Literals(["liveactivity", "alert"])),
  environment: Schema.Literals(["development", "production"]),
  deviceToken: Schema.String,
  priority: Schema.Literals([5, 10]),
  /** The APNs payload, as JSON. */
  body: Schema.Record(Schema.String, Schema.Unknown)
})
export type PushRequest = typeof PushRequest.Type

/** At most this many pairing codes are open for a home at once, as far as the Cloud remembers. */
export const maxPairingCodes = 20

/**
 * The home's open pairing codes, as SHA-256 hashes (hex): every one of them, each time one opens
 * or is spent, and after each Welcome. The Cloud keeps them in memory to send a pairing
 * (`POST /api/devices`, which carries a code and no token) to its home.
 */
export const PairingCodes = Schema.TaggedStruct("PairingCodes", {
  hashes: Schema.Array(Schema.String)
})

export const HomeMessage = Schema.Union([Hello, Proof, Pong, AppResponse, PushRequest, PairingCodes])
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

/** A header a reverse proxy in front of the Cloud requires: it goes into the pairing QR code. */
export const AccessHeader = Schema.Struct({ name: Schema.String, value: Schema.String })

/**
 * The Cloud accepted the Home, under the home id it computed from the Hello's public key. It also
 * says what the Home can't know alone: whether it has an APNs key (`push`, what the console's
 * Settings page shows, never the key), how the app reaches it from outside (`publicAccess`), for
 * the pairing QR code, and its own `version`, for the console.
 */
export const Welcome = Schema.TaggedStruct("Welcome", {
  homeId: Schema.String,
  version: Schema.String,
  push: Schema.Struct({
    configured: Schema.Boolean,
    keyId: Schema.optionalKey(Schema.String),
    teamId: Schema.optionalKey(Schema.String),
    topic: Schema.String
  }),
  publicAccess: Schema.Struct({
    url: Schema.optionalKey(Schema.String),
    headers: Schema.Array(AccessHeader)
  })
})
export type Welcome = typeof Welcome.Type

/** The Cloud turns the Home away (protocol too old, bad proof): retry after the delay. */
export const Refused = Schema.TaggedStruct("Refused", {
  reason: Schema.String,
  retryAfterSeconds: Schema.Number
})

/** `at`: the Cloud's clock, epoch milliseconds; the Home echoes it in Pong to measure the round trip. */
export const Ping = Schema.TaggedStruct("Ping", {
  at: Schema.Number
})

/**
 * The headers of the app's request the Cloud passes on with it; any other stays at the Cloud: the
 * iPhone's token, the body's type, the language, and the request's signature.
 */
export const relayedHeaders: ReadonlyArray<string> = [
  "authorization",
  "content-type",
  "accept-language",
  ...Object.values(signatureHeaders)
]

/** What the Cloud relays of the app: the API's routes, never the console's. */
export const isAppPath = (path: string) => {
  const route = path.split("?")[0]!
  return !route.includes("..") && route.startsWith("/api/")
}

/** How long the Cloud waits for a home to answer one of the app's requests (a release search takes up to 50 s). */
export const appRequestTimeoutSeconds = 60

/**
 * A request of the app, relayed to the home its device token names (or, for a pairing, the home
 * that holds its code): the Home answers it with its own routes, `AppResponse`. The Cloud reads
 * nothing of it but where it goes. Only `isAppPath` paths.
 */
export const AppRequest = Schema.TaggedStruct("AppRequest", {
  id: Schema.String,
  method: Schema.String,
  /** Path and query: `/api/library`. */
  path: Schema.String,
  /** The `relayedHeaders` the app sent, lowercase. */
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.optionalKey(Schema.String)
})
export type AppRequest = typeof AppRequest.Type

/** What APNs answered a `PushRequest`: nothing when it took the push, else why not. */
export const PushResponse = Schema.TaggedStruct("PushResponse", {
  id: Schema.String,
  error: Schema.optionalKey(Schema.Struct({
    /** APNs' HTTP status; null when it never answered, or the Cloud refused the push itself. */
    status: Schema.NullOr(Schema.Number),
    reason: Schema.String,
    /** APNs says the token is gone for good: stop sending to it. */
    tokenGone: Schema.Boolean
  }))
})
export type PushResponse = typeof PushResponse.Type

export const CloudMessage = Schema.Union([Challenge, Welcome, Refused, Ping, AppRequest, PushResponse])
export type CloudMessage = typeof CloudMessage.Type
