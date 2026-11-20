import type { HomeProtocol } from "@quai/api"
import { Context, Effect, Layer, Redacted, Ref, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { HomeConfig, configuredServices, type QBittorrentEndpoint } from "./Config.ts"
import { ServiceError } from "./Errors.ts"

type HomeService = HomeProtocol.HomeService

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

/**
 * Sends requests to the services with their credentials. The keys stay here: the cloud only
 * names a service and a path.
 */
export class ServiceAuth extends Context.Service<ServiceAuth, {
  /** The services with a URL (and key where needed). */
  readonly configured: ReadonlyArray<HomeService>
  /**
   * Sends `request`, whose URL is a path on the service (query included), with the service's
   * credentials. qBittorrent: a 403 logs in (one login at a time) and retries once.
   */
  readonly execute: (
    service: HomeService,
    request: HttpClientRequest.HttpClientRequest
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, ServiceError>
}>()("quai-home/ServiceAuth") {
  static readonly layer = Layer.effect(
    ServiceAuth,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const client = yield* HttpClient.HttpClient
      const qbittorrent = config.qbittorrent === null ? null : yield* qbittorrentSession(client, config.qbittorrent)

      const send = (service: HomeService, request: HttpClientRequest.HttpClientRequest) =>
        client.execute(request).pipe(
          Effect.mapError((cause) => new ServiceError({ service, message: "unreachable", cause }))
        )

      return {
        configured: configuredServices(config),
        execute: (service, request) => {
          switch (service) {
            case "radarr":
            case "sonarr":
            case "jellyfin":
            case "reclaimerr":
            case "seerr": {
              const endpoint = config[service]
              if (endpoint === null) return Effect.fail(new ServiceError({ service, message: "not configured" }))
              const key = Redacted.value(endpoint.apiKey)
              return send(service, request.pipe(
                HttpClientRequest.prependUrl(endpoint.url),
                service === "jellyfin"
                  ? HttpClientRequest.setHeader("Authorization", `MediaBrowser Token="${key}"`)
                  : service === "reclaimerr"
                  ? HttpClientRequest.bearerToken(key)
                  : HttpClientRequest.setHeader("X-Api-Key", key)
              ))
            }
            case "qbittorrent":
              return qbittorrent === null
                ? Effect.fail(new ServiceError({ service, message: "not configured" }))
                : qbittorrent(request)
          }
        }
      }
    })
  )
}

/**
 * qBittorrent's cookie session: logs in when a call gets 403, then retries it once. qBittorrent
 * bans an address after a few failed logins in a row, so logins go one at a time (calls that got
 * a 403 meanwhile reuse the new cookie), and a wrong username or password stops them until Quai
 * Home restarts, which is when its settings can change.
 */
const qbittorrentSession = (client: HttpClient.HttpClient, config: QBittorrentEndpoint) =>
  Effect.gen(function*() {
    const cookie = yield* Ref.make<string | null>(null)
    const wrongCredentials = yield* Ref.make<ServiceError | null>(null)
    const lock = yield* Semaphore.make(1)
    const error = (message: string, cause?: unknown) => new ServiceError({ service: "qbittorrent", message, cause })

    const attemptLogin = Effect.gen(function*() {
      if (config.username === null || config.password === null) {
        return yield* Effect.fail(error("access refused and no password set"))
      }
      const response = yield* client.execute(
        HttpClientRequest.post(`${config.url}/api/v2/auth/login`).pipe(
          HttpClientRequest.setHeader("Referer", config.url),
          HttpClientRequest.bodyUrlParams({ username: config.username, password: Redacted.value(config.password) })
        )
      ).pipe(Effect.mapError((cause) => error("login failed", cause)))
      if (response.status === 403) {
        return yield* Effect.fail(error("login refused: too many failed attempts, qBittorrent banned this address for a while"))
      }
      const session = sessionCookie(response.headers["set-cookie"])
      if (session === null) {
        const body = yield* Effect.orElseSucceed(response.text, () => "")
        if (body.trim() === "Fails.") {
          const refused = error("wrong username or password")
          yield* Ref.set(wrongCredentials, refused)
          yield* Effect.logWarning("qBittorrent: wrong username or password, no more logins until Quai Home restarts")
          return yield* Effect.fail(refused)
        }
        return yield* Effect.fail(error(`login refused (HTTP ${response.status})`))
      }
      yield* Ref.set(cookie, `${session[0]}=${session[1]}`)
    })

    /** `stale` is the cookie the 403 came with: if another call replaced it meanwhile, that one is used. */
    const login = (stale: string | null) =>
      Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
        const refused = yield* Ref.get(wrongCredentials)
        if (refused !== null) return yield* Effect.fail(refused)
        if ((yield* Ref.get(cookie)) !== stale) return
        yield* attemptLogin
      }))

    const send = (request: HttpClientRequest.HttpClientRequest, session: string | null) =>
      client.execute(request.pipe(
        HttpClientRequest.prependUrl(config.url),
        session === null ? (r) => r : HttpClientRequest.setHeader("Cookie", session)
      )).pipe(Effect.mapError((cause) => error("unreachable", cause)))

    return (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function*() {
        // A 403 means the session expired (or never existed): log in once and retry.
        const session = yield* Ref.get(cookie)
        const first = yield* send(request, session)
        if (first.status !== 403) return first
        yield* login(session)
        return yield* send(request, yield* Ref.get(cookie))
      })
  })
