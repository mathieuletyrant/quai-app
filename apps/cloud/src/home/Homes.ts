import { Clock, Context, Effect, Exit, Layer, Option, Schedule, Scope, Semaphore } from "effect"
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http"
import * as DeviceToken from "./DeviceToken.ts"
import { Devices } from "./Devices.ts"
import { HomeLink, HomeLinks } from "./HomeLink.ts"

export const Timing = {
  /** A home gone this long is forgotten: its services stop, and come back if it links again. */
  forgetAfterMs: 60 * 60_000,
  /** How often the homes gone are looked at. */
  sweepMs: 60_000
} as const

type HomeHttp = Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, HttpServerRequest.HttpServerRequest | Scope.Scope>

/** One home's services and routes, built for it alone. */
interface HomeApp {
  readonly link: HomeLink["Service"]
  readonly devices: Devices["Service"]
  readonly http: HomeHttp
  readonly scope: Scope.Closeable
  /** When its Quai Home was last seen gone; null while it is linked. */
  goneSince: number | null
}

/** The bearer token of a request, if it has one. */
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

/**
 * The homes this Cloud serves. Each home gets its own services and routes (its home app: the
 * engine, the Hub, the stores, the whole API, on its own link), built when its Quai Home first
 * links and forgotten an hour after it went away. A request goes to its home's app: an iPhone's
 * by its token, a pairing by its code, the console's by the link it came over. What no home
 * claims goes to an app on no home, which answers what needs none (`/api/health`) and 503 for the
 * rest.
 */
export class Homes extends Context.Service<Homes, {
  /** The routes that answer this request. */
  readonly appFor: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HomeHttp>
  /** The homes with an app now, linked or gone for less than an hour. */
  readonly homeIds: Effect.Effect<ReadonlyArray<string>>
}>()("quai/Homes") {
  /**
   * `app` is one home's routes and services, on the `HomeLink` it is given: built once per home,
   * with what every home shares (`R`) from here.
   */
  static readonly make = <E, R>(app: Layer.Layer<Devices, E, R | HomeLink | HttpRouter.HttpRouter>) =>
    Effect.gen(function*() {
      const links = yield* HomeLinks
      const shared = yield* Effect.context<Exclude<R, HomeLink | HttpRouter.HttpRouter>>()
      const apps = new Map<string, HomeApp>()
      // A home's app is built, or dropped, one at a time.
      const lock = yield* Semaphore.make(1)

      const build = (link: HomeLink["Service"]) =>
        Effect.gen(function*() {
          const scope = yield* Scope.make()
          const memoMap = yield* Layer.makeMemoMap
          const layer = app.pipe(
            Layer.provideMerge(HttpRouter.layer),
            Layer.provide(Layer.succeed(HomeLink, link)),
            Layer.provide(Layer.succeedContext(shared as Context.Context<R>))
          )
          const context = yield* Layer.buildWithMemoMap(layer, memoMap, scope).pipe(Effect.orDie)
          const built: HomeApp = {
            link,
            devices: Context.get(context, Devices),
            http: Context.get(context, HttpRouter.HttpRouter).asHttpEffect(),
            scope,
            goneSince: null
          }
          return built
        })

      const nowhere = yield* build(HomeLink.offline)
      yield* Effect.addFinalizer(() =>
        Effect.forEach([nowhere, ...apps.values()], (a) => Scope.close(a.scope, Exit.void), { discard: true }))

      const ensure = (homeId: string) =>
        Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
          const existing = apps.get(homeId)
          if (existing !== undefined) {
            existing.goneSince = null
            return
          }
          apps.set(homeId, yield* build(yield* links.link(homeId)))
          yield* Effect.logInfo(`home ${homeId}: services started`)
        }))

      /** Forgets the homes gone for an hour, unless one linked again meanwhile. */
      const sweep = Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        for (const [homeId, home] of apps) {
          if (Option.isSome(yield* home.link.home)) {
            home.goneSince = null
            continue
          }
          if (home.goneSince === null) {
            home.goneSince = now
            continue
          }
          if (now - home.goneSince < Timing.forgetAfterMs || !(yield* links.forget(homeId))) continue
          apps.delete(homeId)
          yield* Scope.close(home.scope, Exit.void)
          yield* Effect.logInfo(`home ${homeId}: gone for an hour, services stopped`)
        }
      }))

      yield* Effect.forkScoped(Effect.forever(Effect.flatMap(links.nextReady, ensure)))
      yield* Effect.forkScoped(sweep.pipe(Effect.repeat(Schedule.spaced(Timing.sweepMs))))

      const linked = Effect.suspend(() => Effect.filter([...apps.values()], (home) => Effect.map(home.link.home, Option.isSome)))

      const appFor = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<HomeHttp> =>
        Effect.gen(function*() {
          const token = bearerOf(request)
          if (Option.isSome(token)) {
            const named = DeviceToken.homeOf(token.value)
            if (Option.isSome(named)) return (apps.get(named.value) ?? nowhere).http
            // A token from before several homes: the linked home that holds it.
            const holder = yield* Effect.findFirst(yield* linked, (home) => home.devices.holdsToken(token.value))
            return Option.match(holder, { onNone: () => nowhere.http, onSome: (home) => home.http })
          }
          const code = yield* pairingCodeOf(request)
          if (Option.isSome(code)) {
            const homes = yield* linked
            const holder = yield* Effect.findFirst(homes, (home) => home.devices.holdsPairingCode(code.value))
            // A code no home holds is refused by a linked home, as unknown; with none linked, offline.
            return Option.match(holder, { onNone: () => (homes[0] ?? nowhere).http, onSome: (home) => home.http })
          }
          return nowhere.http
        })

      return { appFor, homeIds: Effect.sync(() => [...apps.keys()]) } satisfies Homes["Service"]
    })

  static readonly layer = <E, R>(app: Layer.Layer<Devices, E, R | HomeLink | HttpRouter.HttpRouter>) =>
    Layer.effect(Homes, Homes.make(app))
}

/** What isn't Quai Home's WebSocket goes to the routes of the home it is for. The console only through Quai Home. */
export const HomesRoute = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const homes = yield* Homes
    yield* router.add("*", "/*", Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const http = yield* homes.appFor(request)
      return yield* http
    }))
  })
)
