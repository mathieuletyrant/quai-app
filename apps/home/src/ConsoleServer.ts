import { consoleSession, ConsoleSession, HomeConsoleApi, HomeProtocol, type HomeOverview } from "@quai/api"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { CloudSeen } from "./CloudSeen.ts"
import { cloudAppUrl, HomeConfig } from "./Config.ts"
import { ConsoleAuth, sessionMs } from "./ConsoleAuth.ts"
import { HomeKey } from "./HomeKey.ts"
import { Link } from "./Link.ts"
import { ServiceAuth } from "./ServiceAuth.ts"
import { checkService } from "./ServiceCheck.ts"
import { ServiceSettings } from "./ServiceSettings.ts"
import { homeVersion } from "./Version.ts"

const cookieName = "quai_session"

/** The session cookie: plain HTTP on the LAN is the usual case, so not `Secure`. */
const cookieOptions = { httpOnly: true, secure: false, sameSite: "strict", path: "/" } as const

const sessionOf = (request: HttpServerRequest.HttpServerRequest) => request.cookies[cookieName]

/** `/home-api` and `/console-api` need a session: 401 without one. */
export const ConsoleSessionLive = Layer.effect(
  ConsoleSession,
  Effect.gen(function*() {
    const auth = yield* ConsoleAuth
    return {
      cookie: (httpEffect, { credential }) =>
        Effect.gen(function*() {
          if ((yield* auth.access(Redacted.value(credential))) !== "signedIn") return yield* Effect.fail(new HttpApiError.Unauthorized())
          return yield* httpEffect
        })
    }
  })
)

const SessionHandlers = HttpApiBuilder.group(HomeConsoleApi, "session", (handlers) =>
  Effect.gen(function*() {
    const auth = yield* ConsoleAuth
    return handlers
      .handle("access", () =>
        Effect.gen(function*() {
          const request = yield* HttpServerRequest.HttpServerRequest
          return { state: yield* auth.access(sessionOf(request)) }
        }))
      .handle("signIn", ({ payload }) =>
        Effect.flatMap(auth.signIn(payload.password), ({ token }) =>
          HttpApiBuilder.securitySetCookie(consoleSession, token, { ...cookieOptions, maxAge: `${sessionMs} millis` })))
      .handle("signOut", () => HttpApiBuilder.securitySetCookie(consoleSession, "", { ...cookieOptions, maxAge: 0 }))
  }))

const HomeHandlers = HttpApiBuilder.group(HomeConsoleApi, "home", (handlers) =>
  Effect.gen(function*() {
    const config = yield* HomeConfig
    const key = yield* HomeKey
    const link = yield* Link
    const cloudSeen = yield* CloudSeen
    const appUrl = cloudAppUrl(config)
    return handlers
      .handle("overview", () =>
        Effect.gen(function*() {
          const previous = yield* cloudSeen.previous
          return {
            homeId: key.homeId,
            version: homeVersion,
            cloud: {
              configured: config.cloudUrl !== null,
              linked: yield* link.linked,
              ...(appUrl === null ? {} : { url: appUrl }),
              ...Option.match(previous, { onNone: () => ({}), onSome: (previousUrl) => ({ previousUrl }) })
            }
          } satisfies HomeOverview
        }))
      .handle("acknowledgeCloud", () => cloudSeen.acknowledge)
  }))

const ServicesHandlers = HttpApiBuilder.group(HomeConsoleApi, "services", (handlers) =>
  Effect.gen(function*() {
    const settings = yield* ServiceSettings
    const auth = yield* ServiceAuth
    const check = (service: HomeProtocol.HomeService) => Effect.provideService(checkService(service), ServiceAuth, auth)
    const storeFailed = (error: { readonly message: string }) =>
      Effect.andThen(Effect.logWarning(error.message), Effect.die(error))
    return handlers
      .handle("list", () => settings.list)
      .handle("save", ({ params, payload }) =>
        Effect.gen(function*() {
          yield* settings.save(params.service, payload).pipe(Effect.catchTag("StoreError", storeFailed))
          const setup = (yield* settings.list).find((s) => s.service === params.service)!
          return { setup, check: yield* check(params.service) }
        }))
      .handle("remove", ({ params }) => settings.remove(params.service).pipe(Effect.catchTag("StoreError", storeFailed)))
      .handle("check", ({ params }) => check(params.service))
  }))

/** Quai Home's own console routes, `/home-api`. */
export const HomeApiLive = HttpApiBuilder.layer(HomeConsoleApi).pipe(
  Layer.provide([SessionHandlers, HomeHandlers, ServicesHandlers]),
  Layer.provide(ConsoleSessionLive)
)

/** The answer the console reads as "Quai Cloud isn't reachable": the Cloud's own `HomeOffline` shape. */
const unreachable = (message: string) => HttpServerResponse.jsonUnsafe({ _tag: "HomeOffline", message }, { status: 503 })

/**
 * The rest of the console, `/console-api` and `/api/health`: Quai Cloud's routes, relayed over the
 * link with the console's session checked here. The Cloud answers them only from a linked Home.
 */
export const ConsoleRelayLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const auth = yield* ConsoleAuth
    const link = yield* Link
    const relay = Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      if ((yield* auth.access(sessionOf(request))) !== "signedIn") {
        return HttpServerResponse.jsonUnsafe({ _tag: "Unauthorized" }, { status: 401 })
      }
      const method = request.method
      if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "DELETE") return HttpServerResponse.empty({ status: 405 })
      if (!HomeProtocol.isConsolePath(request.url)) return HttpServerResponse.empty({ status: 404 })
      const body = method === "GET" ? "" : yield* Effect.orElseSucceed(request.text, () => "")
      return yield* link.console({ method, path: request.url, ...(body === "" ? {} : { body }) }).pipe(
        Effect.map((answer) =>
          answer.body === ""
            ? HttpServerResponse.empty({ status: answer.status })
            : HttpServerResponse.text(answer.body, { status: answer.status, contentType: "application/json" })),
        Effect.catchTag("CloudUnreachable", (error) => Effect.succeed(unreachable(error.message)))
      )
    })
    yield* router.add("*", "/console-api/*", relay)
    yield* router.add("*", "/api/health", relay)
  })
)

/** The built console, when `QUAI_CONSOLE_DIR` is set (it is in the image). */
export const ConsoleFilesLive = Layer.unwrap(
  Effect.gen(function*() {
    const { consoleDir } = yield* HomeConfig
    return consoleDir === null ? Layer.empty : HttpStaticServer.layer({ root: consoleDir, spa: true })
  })
)
