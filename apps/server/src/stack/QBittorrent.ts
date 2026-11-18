import { Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
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

/** qBittorrent's "unknown" ETA (100 days). */
const infiniteEta = 8_640_000

export const progressEvent = (torrent: Torrent): MediaEvent => ({
  _tag: "Progress",
  downloadId: torrent.hash.toLowerCase(),
  progress: torrent.progress,
  bytesPerSecond: torrent.dlspeed,
  remainingSeconds: torrent.eta >= infiniteEta || torrent.eta < 0 ? null : torrent.eta
})

export class QBittorrent extends Context.Service<QBittorrent, {
  /** Progress of the given torrents, by hash. Unknown hashes are left out. */
  readonly progress: (hashes: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<MediaEvent>, StackError>
}>()("quai/QBittorrent") {
  static readonly layer = Layer.effect(
    QBittorrent,
    Effect.gen(function*() {
      const config = (yield* StackConfig).qbittorrent
      const cookies = yield* Ref.make(new Map<string, string>())
      const base = yield* HttpClient.HttpClient
      const fail = (message: string) => (cause: unknown) => new StackError({ service: "qbittorrent", message, cause })

      if (config === null) {
        return { progress: () => Effect.fail(new StackError({ service: "qbittorrent", message: "not configured" })) }
      }

      const login = Effect.gen(function*() {
        if (config.username === null || config.password === null) return
        const response = yield* base.execute(
          HttpClientRequest.post(`${config.url}/api/v2/auth/login`).pipe(
            HttpClientRequest.setHeader("Referer", config.url),
            HttpClientRequest.bodyUrlParams({ username: config.username, password: Redacted.value(config.password) })
          )
        )
        const sid = (response.headers["set-cookie"] ?? "").match(/SID=([^;]+)/)?.[1]
        if (sid === undefined) return yield* Effect.fail(new Error("login refused"))
        yield* Ref.set(cookies, new Map([["SID", sid]]))
      }).pipe(Effect.mapError(fail("login failed")))

      const info = (hashes: ReadonlyArray<string>) =>
        Effect.gen(function*() {
          const jar = yield* Ref.get(cookies)
          const request = HttpClientRequest.get(`${config.url}/api/v2/torrents/info`).pipe(
            HttpClientRequest.setUrlParam("hashes", hashes.join("|")),
            jar.has("SID") ? HttpClientRequest.setHeader("Cookie", `SID=${jar.get("SID")}`) : (r) => r
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
