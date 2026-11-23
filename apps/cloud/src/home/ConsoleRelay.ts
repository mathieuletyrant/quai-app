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

/** A relayed request, as the Cloud's own routes read it. */
const webRequest = (request: { readonly method: string; readonly path: string; readonly body?: string }) =>
  new Request(`http://quai-cloud${request.path}`, {
    method: request.method,
    ...(request.body === undefined ? {} : { body: request.body, headers: { "content-type": "application/json" } })
  })

/**
 * Answers the console requests Quai Home relays with the Cloud's own routes, the same router the
 * public port serves: no second handler for any route.
 */
export const ConsoleRelayLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const router = yield* HttpRouter.HttpRouter
    const link = yield* HomeLink
    yield* link.answerConsole((request) =>
      Effect.gen(function*() {
        const response = yield* router.asHttpEffect().pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(webRequest(request))),
          Effect.provideService(FromHomeConsole, true)
        )
        const web = HttpServerResponse.toWeb(response)
        const body = yield* Effect.promise(() => web.text())
        return { status: web.status, body }
      }).pipe(
        Effect.scoped,
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning(`could not answer the console's ${request.method} ${request.path}`, cause), { status: 500, body: "" }))
      ))
  })
)
