import { Clock, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { MediaEvent } from "../engine/Events.ts"
import { StackError } from "./Errors.ts"
import { StackConfig } from "./StackConfig.ts"

const Torrent = Schema.Struct({
  hash: Schema.String,
  progress: Schema.Number,
  dlspeed: Schema.Number,
  eta: Schema.Number,
  state: Schema.String
})
export const Torrents = Schema.Array(Torrent)
export type Torrent = typeof Torrent.Type

/**
 * After failed logins, wait before trying again: 30 s, 1 min, 2 min, then every 5 min.
 * qBittorrent bans an address after 5 failures in a row; this keeps well under that pace.
 * A right password never waits, and changing it restarts Quai, which starts over.
 */
export const loginBackoffMs = (failures: number) => Math.min(30_000 * 2 ** (failures - 1), 5 * 60_000)

/** qBittorrent's "unknown" ETA (100 days). */
const infiniteEta = 8_640_000

export const progressEvent = (torrent: Torrent): MediaEvent => ({
  _tag: "Progress",
  downloadId: torrent.hash.toLowerCase(),
  progress: torrent.progress,
  bytesPerSecond: torrent.dlspeed,
  remainingSeconds: torrent.eta >= infiniteEta || torrent.eta < 0 ? null : torrent.eta
})

/**
 * The session cookie: `SID` up to qBittorrent 4, `QBT_SID_<port>` since 5 (one per instance).
 * Set-Cookie may come as one string or several.
 */
export const sessionCookie = (header: string | ReadonlyArray<string> | undefined): readonly [string, string] | null => {
  const lines = header === undefined ? [] : typeof header === "string" ? [header] : header
  for (const line of lines) {
    const match = line.match(/(?:^|[;,]\s*)((?:QBT_)?SID(?:_\d+)?)=([^;]+)/)
    if (match !== null) return [match[1]!, match[2]!]
  }
  return null
}

export class QBittorrent extends Context.Service<QBittorrent, {
  /** Progress of the given torrents, by hash. Unknown hashes are left out. */
  readonly progress: (hashes: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<MediaEvent>, StackError>
}>()("quai/QBittorrent") {
  static readonly layer = Layer.effect(
    QBittorrent,
    Effect.gen(function*() {
      const config = (yield* StackConfig).qbittorrent
      const cookies = yield* Ref.make(new Map<string, string>())
      const lastFailure = yield* Ref.make<{ at: number; count: number; error: StackError } | null>(null)
      const base = yield* HttpClient.HttpClient
      const fail = (message: string) => (cause: unknown) => new StackError({ service: "qbittorrent", message, cause })

      if (config === null) {
        return { progress: () => Effect.fail(new StackError({ service: "qbittorrent", message: "not configured" })) }
      }

      const attemptLogin = Effect.gen(function*() {
        if (config.username === null || config.password === null) {
          return yield* Effect.fail(new StackError({ service: "qbittorrent", message: "access refused and no password set" }))
        }
        const response = yield* base.execute(
          HttpClientRequest.post(`${config.url}/api/v2/auth/login`).pipe(
            HttpClientRequest.setHeader("Referer", config.url),
            HttpClientRequest.bodyUrlParams({ username: config.username, password: Redacted.value(config.password) })
          )
        ).pipe(Effect.mapError(fail("login failed")))
        if (response.status === 403) {
          return yield* Effect.fail(new StackError({ service: "qbittorrent", message: "login refused: too many failed attempts, qBittorrent banned this address for a while" }))
        }
        const cookie = sessionCookie(response.headers["set-cookie"])
        if (cookie === null) {
          const body = yield* Effect.orElseSucceed(response.text, () => "")
          return yield* Effect.fail(new StackError({
            service: "qbittorrent",
            message: body.trim() === "Fails." ? "wrong username or password" : `login refused (HTTP ${response.status})`
          }))
        }
        yield* Ref.set(cookies, new Map([cookie]))
      })

      const login = Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const failed = yield* Ref.get(lastFailure)
        if (failed !== null && now - failed.at < loginBackoffMs(failed.count)) return yield* Effect.fail(failed.error)
        yield* attemptLogin.pipe(
          Effect.tapError((error) => Ref.set(lastFailure, { at: now, count: (failed?.count ?? 0) + 1, error })),
          Effect.tap(() => Ref.set(lastFailure, null))
        )
      })

      const info = (hashes: ReadonlyArray<string>) =>
        Effect.gen(function*() {
          const jar = yield* Ref.get(cookies)
          const request = HttpClientRequest.get(`${config.url}/api/v2/torrents/info`).pipe(
            HttpClientRequest.setUrlParam("hashes", hashes.join("|")),
            jar.size > 0
              ? HttpClientRequest.setHeader("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "))
              : (r) => r
          )
          const response = yield* base.execute(request)
          if (response.status === 403) return null
          if (response.status !== 200) return yield* Effect.fail(new Error(`HTTP ${response.status}`))
          return yield* Schema.decodeUnknownEffect(Torrents)(yield* response.json)
        }).pipe(Effect.mapError(fail("could not read torrents")))

      return {
        progress: (hashes: ReadonlyArray<string>) =>
          hashes.length === 0 ? Effect.succeed([]) : Effect.gen(function*() {
            // A 403 means the session expired (or never existed): log in once and retry.
            const first = yield* info(hashes)
            const torrents = first ?? (yield* Effect.andThen(login, info(hashes)))
            if (torrents === null) return yield* Effect.fail(new StackError({ service: "qbittorrent", message: "access refused" }))
            return torrents.map(progressEvent)
          })
      }
    })
  )
}
