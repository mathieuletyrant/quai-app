import type { ApnsEnvironment, PushSettings } from "@quai/api"
import { Apns, ApnsError, type ApnsRequest } from "@quai/domain/push/Apns.ts"
import { Clock, Config, Effect, Layer, Option, Redacted, Ref, type Scope } from "effect"
import { existsSync, readFileSync } from "node:fs"
import * as http2 from "node:http2"
import { signApnsJwt } from "./ApnsJwt.ts"

export const apnsHosts: Record<ApnsEnvironment, string> = {
  development: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com"
}

export interface ApnsCredentials {
  readonly keyPem: Redacted.Redacted<string>
  readonly keyId: string
  readonly teamId: string
  /** The app's bundle id: notifications go to it, Live Activity pushes to `<topic>.push-type.liveactivity`. */
  readonly topic: string
}

/** Refresh the provider token every 50 minutes (APNs rejects tokens older than an hour). */
const jwtLifetimeMs = 50 * 60_000

/**
 * How long one push may wait for APNs' answer. The Hub handles events one at a time, so a send
 * that never ends would freeze every flow behind it.
 */
export const sendTimeoutMs = 10_000

/**
 * A connection idle for this long is closed before the next push rather than reused: a network
 * between Quai and Apple may forget an idle connection without a word, and the next push then waits
 * on a dead one (2026-11-23: a Start lost this way, so the Live Activity never appeared).
 */
export const idleMs = 5 * 60_000

const timeoutReason = `no answer within ${sendTimeoutMs / 1000} s`

/** The iOS app's bundle id when `QUAI_APNS_TOPIC` isn't set. */
export const defaultTopic = "com.mathieuletyrant.quai"

/**
 * The Apple push key is Quai Cloud's own configuration, never home data: `QUAI_APNS_KEY_FILE` (or
 * `QUAI_APNS_KEY`, the .p8 text), `QUAI_APNS_KEY_ID`, `QUAI_APNS_TEAM_ID` and `QUAI_APNS_TOPIC`.
 * A key file that isn't there yet means "no pushes", not a crash.
 */
export const credentialsFromEnvironment = Effect.gen(function*() {
  const topic = yield* Config.String("QUAI_APNS_TOPIC").pipe(Config.withDefault(defaultTopic))
  const file = yield* Config.option(Config.String("QUAI_APNS_KEY_FILE"))
  const inline = yield* Config.option(Config.Redacted("QUAI_APNS_KEY"))
  const keyId = yield* Config.option(Config.String("QUAI_APNS_KEY_ID"))
  const teamId = yield* Config.option(Config.String("QUAI_APNS_TEAM_ID"))
  const keyPem = Option.isSome(inline)
    ? Option.some(inline.value)
    : Option.flatMap(
      file,
      (path) => existsSync(path) ? Option.some(Redacted.make(readFileSync(path, "utf8"))) : Option.none()
    )
  const credentials: ApnsCredentials | null = Option.isSome(keyPem) && Option.isSome(keyId) && Option.isSome(teamId)
    ? { keyPem: keyPem.value, keyId: keyId.value, teamId: teamId.value, topic }
    : null
  return { credentials, topic }
})

/** Quai Cloud's pushes to APNs, with this key (none: nothing is pushed). `hosts` is overridable so tests can point it at a local fake. */
export const makeApns = (
  credentials: ApnsCredentials | null,
  hosts: Record<ApnsEnvironment, string> = apnsHosts,
  topic = defaultTopic
): Effect.Effect<Apns["Service"], never, Scope.Scope> =>
  Effect.gen(function*() {
    const client = yield* makeClient(credentials, hosts)
    const settings: PushSettings = credentials === null
      ? { configured: false, topic }
      : { configured: true, keyId: credentials.keyId, teamId: credentials.teamId, topic: credentials.topic }
    return { configured: Effect.succeed(client.configured), settings, send: client.send }
  })

/** The key from the environment. */
export const ApnsLive = Layer.effect(
  Apns,
  Effect.gen(function*() {
    const { credentials, topic } = yield* credentialsFromEnvironment.pipe(Effect.orDie)
    yield* Effect.logInfo(
      credentials === null ? "No APNs key: Live Activities won't be pushed" : `APNs key ${credentials.keyId}`
    )
    return yield* makeApns(credentials, apnsHosts, topic)
  })
)

/** One HTTP/2 session per APNs server, opened on first use and reopened when it drops; closed with the scope. */
const makeClient = (credentials: ApnsCredentials | null, hosts: Record<ApnsEnvironment, string>) =>
  Effect.gen(function*() {
    if (credentials === null) {
      return {
        configured: false,
        send: () => Effect.fail(new ApnsError({ status: null, reason: "APNs key not configured", tokenGone: false }))
      }
    }
    const sessions = new Map<ApnsEnvironment, http2.ClientHttp2Session>()
    /** When each session last sent a push, epoch milliseconds. */
    const lastUsed = new Map<http2.ClientHttp2Session, number>()
    const jwt = yield* Ref.make<{ token: string; issuedAt: number } | null>(null)
    yield* Effect.addFinalizer(() => Effect.sync(() => sessions.forEach((connection) => connection.close())))

    const session = (environment: ApnsEnvironment, now: number) => {
      const existing = sessions.get(environment)
      if (existing !== undefined && !existing.closed && !existing.destroyed) {
        if (now - (lastUsed.get(existing) ?? now) < idleMs) {
          lastUsed.set(existing, now)
          return existing
        }
        sessions.delete(environment)
        lastUsed.delete(existing)
        existing.close()
      }
      const created = http2.connect(hosts[environment])
      // Only while it is the current one: a session dropped after a timeout may close after its successor opened.
      const forget = () => {
        lastUsed.delete(created)
        if (sessions.get(environment) === created) sessions.delete(environment)
      }
      created.on("error", forget)
      created.on("close", forget)
      created.on("goaway", forget)
      // Don't keep the process alive just for an idle push connection.
      created.unref()
      sessions.set(environment, created)
      lastUsed.set(created, now)
      return created
    }

    const providerToken = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      const current = yield* Ref.get(jwt)
      if (current !== null && now - current.issuedAt < jwtLifetimeMs) return current.token
      const token = signApnsJwt({
        keyPem: Redacted.value(credentials.keyPem),
        keyId: credentials.keyId,
        teamId: credentials.teamId,
        issuedAt: now
      })
      yield* Ref.set(jwt, { token, issuedAt: now })
      return token
    })

    /** One try: an answer, an error, or no answer within `sendTimeoutMs` (the connection is dropped). */
    const attempt = (request: ApnsRequest) =>
      Effect.gen(function*() {
        const token = yield* providerToken
        const now = yield* Clock.currentTimeMillis
        const body = JSON.stringify(request.body)
        let opened: http2.ClientHttp2Session | undefined
        return yield* Effect.callback<void, ApnsError>((resume) => {
          let stream: http2.ClientHttp2Stream
          try {
            opened = session(request.environment, now)
            stream = opened.request({
              ":method": "POST",
              ":path": `/3/device/${request.deviceToken}`,
              authorization: `bearer ${token}`,
              "apns-push-type": request.pushType ?? "liveactivity",
              "apns-topic": request.pushType === "alert"
                ? credentials.topic
                : `${credentials.topic}.push-type.liveactivity`,
              "apns-priority": String(request.priority),
              "apns-expiration": String(Math.floor(now / 1000) + 3600),
              "content-type": "application/json"
            })
          } catch (cause) {
            resume(Effect.fail(new ApnsError({ status: null, reason: String(cause), tokenGone: false })))
            return
          }
          let status = 0
          let response = ""
          stream.setEncoding("utf8")
          stream.on("response", (headers) => (status = Number(headers[":status"])))
          stream.on("data", (chunk: string) => (response += chunk))
          stream.on("error", (cause) =>
            resume(Effect.fail(new ApnsError({ status: null, reason: String(cause), tokenGone: false }))))
          stream.on("end", () => {
            if (status === 200) {
              return resume(Effect.void)
            }
            const reason = parseReason(response)
            resume(Effect.fail(new ApnsError({ status, reason, tokenGone: isTokenGone(status, reason) })))
          })
          stream.end(body)
          return Effect.sync(() =>
            stream.close(http2.constants.NGHTTP2_CANCEL)
          )
        }).pipe(
          Effect.timeoutOrElse({
            duration: sendTimeoutMs,
            // A connection that stopped answering: drop it, the next send opens a new one.
            orElse: () =>
              Effect.gen(function*() {
                if (opened !== undefined) {
                  if (sessions.get(request.environment) === opened) sessions.delete(request.environment)
                  opened.destroy()
                }
                if (opened !== undefined) lastUsed.delete(opened)
                yield* Effect.logWarning(
                  `APNs ${request.environment} didn't answer within ${sendTimeoutMs / 1000} s: reconnecting`
                )
                return yield* Effect.fail(new ApnsError({ status: null, reason: timeoutReason, tokenGone: false }))
              })
          })
        )
      })

    /**
     * A push that got no answer is tried once more, on a new connection: a dead connection most
     * likely never carried it, and a lost Start means no Live Activity at all.
     */
    const send = (request: ApnsRequest) =>
      attempt(request).pipe(
        Effect.catchTag("ApnsError", (error) => error.reason === timeoutReason ? attempt(request) : Effect.fail(error))
      )

    return { configured: true, send }
  })

const parseReason = (body: string) => {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? "Unknown"
  } catch {
    return body || "Unknown"
  }
}

/** https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns */
const isTokenGone = (status: number, reason: string) =>
  status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic"
