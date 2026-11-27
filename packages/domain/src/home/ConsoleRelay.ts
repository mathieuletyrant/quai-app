import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HomeLink } from "./HomeLink.ts"

/** Set while a request comes from Quai Home's console, relayed over the link. */
export const FromHomeConsole = Context.Reference<boolean>("quai/FromHomeConsole", { defaultValue: () => false })

/**
 * The console is served by Quai Home, which checks its password: `/console-api` answers only the
 * requests it relays, never a request on the Cloud's public port.
 */
export const ConsoleOnlyThroughHome = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.url.startsWith("/console-api") && !(yield* FromHomeConsole)) {
      return HttpServerResponse.text("The console is served by Quai Home.", { status: 404 })
    }
    return yield* httpEffect
  }), { global: true })

/** A request that came over the home link, not on a port: the console's, or the app's through Quai Cloud. */
export interface RelayedRequest {
  readonly method: string
  /** Path and query. */
  readonly path: string
  readonly headers?: Readonly<Record<string, string>>
  /** JSON, as it was sent. */
  readonly body?: string
}

/** What the routes answered a relayed request. */
export interface RelayedAnswer {
  readonly status: number
  /** Set when there is a body and it isn't JSON. */
  readonly contentType?: string
  readonly body: string
}

/** A relayed request, as the routes read it. */
const webRequest = (request: RelayedRequest) =>
  new Request(`http://quai${request.path}`, {
    method: request.method,
    headers: {
      ...request.headers,
      ...(request.body === undefined || request.headers?.["content-type"] !== undefined
        ? {}
        : { "content-type": "application/json" })
    },
    ...(request.body === undefined ? {} : { body: request.body })
  })

const isJson = (contentType: string | null) => contentType === null || contentType.startsWith("application/json")

/**
 * Answers a relayed request with the home's own routes, the same router a port would serve: no
 * second handler for any route. `fromConsole` opens the console's routes to it. Never fails: what
 * goes wrong is a 500, logged.
 */
export const answerRelayed = (
  router: HttpRouter.HttpRouter,
  request: RelayedRequest,
  options: { readonly fromConsole: boolean }
): Effect.Effect<RelayedAnswer> =>
  Effect.gen(function*() {
    const response = yield* router.asHttpEffect().pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(webRequest(request))),
      Effect.provideService(FromHomeConsole, options.fromConsole)
    )
    const web = HttpServerResponse.toWeb(response)
    const body = yield* Effect.promise(() => web.text())
    const contentType = web.headers.get("content-type")
    return { status: web.status, body, ...(body === "" || isJson(contentType) ? {} : { contentType: contentType! }) }
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning(`could not answer ${request.method} ${request.path.split("?")[0]}`, cause), {
        status: 500,
        body: ""
      })
    )
  )

/**
 * Answers the console requests Quai Home relays with the home's own routes (`answerRelayed`).
 */
export const ConsoleRelayLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const router = yield* HttpRouter.HttpRouter
    const link = yield* HomeLink
    yield* link.answerConsole((request) => answerRelayed(router, request, { fromConsole: true }))
  })
)
