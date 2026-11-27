import { HomeProtocol } from "@quai/api"
import * as DeviceToken from "@quai/domain/home/DeviceToken.ts"
import { offlineMessage } from "@quai/domain/home/HomeLink.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type AppRelay, HomeLinks } from "./HomeLinks.ts"

type HomeHttp = Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>

const bearerOf = (request: HttpServerRequest.HttpServerRequest): Option.Option<string> => {
  const header = request.headers["authorization"]
  if (header === undefined || !/^bearer /i.test(header)) return Option.none()
  const token = header.slice("bearer ".length).trim()
  return token === "" ? Option.none() : Option.some(token)
}

const pathOf = (url: string) => url.split("?")[0]!

/** The code of a pairing request (`POST /api/devices`), if its body has one. */
const pairingCodeOf = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<Option.Option<string>> =>
  request.method !== "POST" || pathOf(request.url) !== "/api/devices"
    ? Effect.succeed(Option.none())
    : request.json.pipe(
      Effect.map((body) => {
        const code = typeof body === "object" && body !== null ? (body as Record<string, unknown>).code : undefined
        return typeof code === "string" ? Option.some(code) : Option.none()
      }),
      Effect.orElseSucceed(() => Option.none())
    )

/** The `relayedHeaders` of a request, as the home gets them. */
const relayedHeadersOf = (request: HttpServerRequest.HttpServerRequest): Record<string, string> =>
  Object.fromEntries(HomeProtocol.relayedHeaders.flatMap((name) => {
    const value = request.headers[name]
    return value === undefined ? [] : [[name, value]]
  }))

/** What the app is told when its home didn't answer: the API's own `HomeOffline`, 503. */
const homeOffline = (message: string) =>
  HttpServerResponse.jsonUnsafe({ _tag: "HomeOffline", message }, { status: 503 })

/**
 * The app's request, passed to its home and answered with what it answered. The Cloud reads the
 * path, to relay the API's routes only, and nothing else.
 */
export const relayed = (relay: AppRelay): HomeHttp =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!HomeProtocol.isAppPath(request.url)) return HttpServerResponse.empty({ status: 404 })
    const body = request.method === "GET" || request.method === "HEAD"
      ? ""
      : yield* Effect.orElseSucceed(request.text, () => "")
    return yield* relay({
      method: request.method,
      path: request.url,
      headers: relayedHeadersOf(request),
      ...(body === "" ? {} : { body })
    }).pipe(
      Effect.map((answer) =>
        answer.body === ""
          ? HttpServerResponse.empty({ status: answer.status })
          : HttpServerResponse.text(answer.body, {
            status: answer.status,
            contentType: answer.contentType ?? "application/json"
          })
      ),
      Effect.catchTag("HomeError", (error) =>
        Effect.succeed(homeOffline(error.reason === "offline" ? offlineMessage : `Quai Home: ${error.message}`)))
    )
  })

/**
 * Where each request of the app goes: to the home it is for, relayed (`relayed`). An iPhone's by
 * its token's home id, a pairing by the home that said its code is open. A token from before
 * several homes, or a request that names none, goes to the only home connected, when there is
 * exactly one. With no home to send it to, the app is told its home is offline (503); the Cloud's
 * own health (`/api/health` naming no home) answers here.
 */
export class Homes extends Context.Service<Homes, {
  /** The routes that answer this request. */
  readonly appFor: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HomeHttp>
}>()("quai/Homes") {
  static readonly make = Effect.gen(function*() {
    const links = yield* HomeLinks
    const info = yield* ServerInfo

    const offline: HomeHttp = Effect.succeed(homeOffline(offlineMessage))
    const notFound: HomeHttp = Effect.succeed(HttpServerResponse.empty({ status: 404 }))

    /** The Cloud's own health: it is up, whatever home is connected. */
    const health: HomeHttp = Effect.map(Clock.currentTimeMillis, (now) =>
      HttpServerResponse.jsonUnsafe({
        status: "ok",
        version: info.version,
        uptimeSeconds: Math.max(0, Math.floor((now - info.startedAt) / 1000))
      }))

    const relayedTo = (relay: Option.Option<AppRelay>) =>
      Option.match(relay, { onNone: () => offline, onSome: relayed })

    /** The only home connected, when there is exactly one: where what names no home may go. */
    const onlyHome = Effect.gen(function*() {
      const homes = yield* links.homeIds
      return homes.length === 1 ? yield* links.relayOf(homes[0]!) : Option.none<AppRelay>()
    })

    /**
     * A pairing: the home that said its code is open, else a home connected, which refuses a code it
     * doesn't hold as unknown. Offline only when no home is connected.
     */
    const pairingHome = (code: string) =>
      Effect.gen(function*() {
        const announced = yield* links.pairingHome(code)
        if (Option.isSome(announced)) return yield* links.relayOf(announced.value)
        const [anyHome] = yield* links.homeIds
        return anyHome === undefined ? Option.none<AppRelay>() : yield* links.relayOf(anyHome)
      })

    const appFor = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<HomeHttp> =>
      Effect.gen(function*() {
        // The console is Quai Home's alone: nothing but the API's routes is answered here.
        if (!HomeProtocol.isAppPath(request.url)) return notFound
        const token = bearerOf(request)
        if (Option.isSome(token)) {
          const named = DeviceToken.homeOf(token.value)
          return relayedTo(yield* Option.isSome(named) ? links.relayOf(named.value) : onlyHome)
        }
        const code = yield* pairingCodeOf(request)
        if (Option.isSome(code)) return relayedTo(yield* pairingHome(code.value))
        if (request.method === "GET" && pathOf(request.url) === "/api/health") return health
        return relayedTo(yield* onlyHome)
      })

    return { appFor } satisfies Homes["Service"]
  })

  static readonly layer = Layer.effect(Homes, Homes.make)
}

/** What isn't Quai Home's WebSocket goes to the home it is for. The console only through Quai Home. */
export const HomesRoute = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const homes = yield* Homes
    yield* router.add(
      "*",
      "/*",
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const http = yield* homes.appFor(request)
        return yield* http
      })
    )
  })
)
