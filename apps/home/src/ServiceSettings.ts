import { type HomeProtocol, InvalidService, type ServiceInput, type ServiceSetup, SetByEnvironment } from "@quai/api"
import { Context, Effect, FileSystem, Layer, PubSub, Redacted, Ref, Schema, type Scope } from "effect"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { allServices, type Endpoints, HomeConfig } from "./Config.ts"
import { StoreError } from "./Errors.ts"

type HomeService = HomeProtocol.HomeService

/** What `services.json` holds: what the Services page saved, keys in clear (the file is 0600). */
const Saved = Schema.Record(Schema.String, Schema.Struct({
  url: Schema.String,
  secret: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String)
}))
type Saved = typeof Saved.Type
type SavedService = Saved[string]

const SavedJson = Schema.fromJsonString(Saved)

const noEndpoints: Endpoints = Object.fromEntries(allServices.map((s) => [s, null])) as unknown as Endpoints

/** A saved service as `ServiceAuth` uses it. qBittorrent may log in without a user name. */
export const endpointOf = (service: HomeService, saved: SavedService): Endpoints[HomeService] =>
  service === "qbittorrent"
    ? {
      url: saved.url,
      username: saved.username ?? null,
      password: saved.secret === undefined ? null : Redacted.make(saved.secret)
    }
    : saved.secret === undefined
    ? null
    : { url: saved.url, apiKey: Redacted.make(saved.secret) }

/**
 * Checks what the Services page sends, and merges it into what was saved: a secret left out keeps
 * the saved one. A URL must be http(s); every service but qBittorrent needs a key.
 */
export const merged = (
  service: HomeService,
  input: ServiceInput,
  before: SavedService | undefined
): SavedService | InvalidService => {
  const url = input.url.trim().replace(/\/+$/, "")
  if (!/^https?:\/\/[^\s/]+/.test(url)) {
    return new InvalidService({ message: "The address must start with http:// or https://" })
  }
  const secret = input.secret === undefined || input.secret === "" ? before?.secret : input.secret
  if (service !== "qbittorrent" && secret === undefined) return new InvalidService({ message: "The API key is missing" })
  const username = input.username?.trim()
  return {
    url,
    ...(secret === undefined ? {} : { secret }),
    ...(service === "qbittorrent" && username !== undefined && username !== "" ? { username } : {})
  }
}

/**
 * The services' addresses and keys: the environment's (`QUAI_RADARR_URL`…), which win, and what
 * the console's Services page saved in `/data/services.json`. Never sent to the Cloud: the Home
 * only tells it which services it reaches. A change applies at once, and is published to `changes`.
 */
export class ServiceSettings extends Context.Service<ServiceSettings, {
  readonly current: Effect.Effect<Endpoints>
  /** Each service as the Services page shows it: its source, its address, never its key. */
  readonly list: Effect.Effect<ReadonlyArray<ServiceSetup>>
  readonly save: (service: HomeService, input: ServiceInput) => Effect.Effect<void, SetByEnvironment | InvalidService | StoreError>
  readonly remove: (service: HomeService) => Effect.Effect<void, SetByEnvironment | StoreError>
  /** The services that change from now on, one by one. */
  readonly changes: Effect.Effect<PubSub.Subscription<HomeService>, never, Scope.Scope>
}>()("quai-home/ServiceSettings") {
  static readonly make = (path: string) =>
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const fs = yield* FileSystem.FileSystem
      const fail = (message: string) => (cause: unknown) => new StoreError({ message, cause })

      const exists = yield* fs.exists(path).pipe(Effect.mapError(fail(`could not read ${path}`)))
      const initial: Saved = exists
        ? yield* fs.readFileString(path).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SavedJson)),
          Effect.catch((cause) => Effect.as(Effect.logWarning(`${path} can't be read: no service saved from the console`, cause), {}))
        )
        : {}
      const saved = yield* Ref.make<Saved>(initial)
      const pubsub = yield* PubSub.unbounded<HomeService>()

      const fromEnvironment = (service: HomeService) => config[service] !== null

      const endpoints = (all: Saved): Endpoints => {
        const result: Record<string, unknown> = { ...noEndpoints }
        for (const service of allServices) {
          const own = all[service]
          result[service] = config[service] ?? (own === undefined ? null : endpointOf(service, own))
        }
        return result as unknown as Endpoints
      }

      const write = (all: Saved) =>
        Effect.gen(function*() {
          const text = yield* Schema.encodeEffect(SavedJson)(all).pipe(Effect.mapError(fail("could not encode the services")))
          const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`)
          yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
            Effect.andThen(fs.writeFileString(temp, text, { mode: 0o600 })),
            Effect.andThen(fs.rename(temp, path)),
            Effect.tapError(() => Effect.ignore(fs.remove(temp, { force: true }))),
            Effect.mapError(fail(`could not write ${path}`))
          )
        })

      const update = (service: HomeService, f: (all: Saved) => Saved) =>
        Effect.gen(function*() {
          const next = f(yield* Ref.get(saved))
          yield* write(next)
          yield* Ref.set(saved, next)
          yield* PubSub.publish(pubsub, service)
        })

      const setByEnvironment = (service: HomeService) =>
        new SetByEnvironment({ message: `Set by QUAI_${service.toUpperCase()}_* on Quai Home: change it there` })

      const setupOf = (service: HomeService, all: Saved): ServiceSetup => {
        const env = config[service]
        if (env !== null) {
          return {
            service,
            source: "environment",
            url: env.url,
            ...("username" in env && env.username !== null ? { username: env.username } : {}),
            hasSecret: "apiKey" in env || env.password !== null
          }
        }
        const own = all[service]
        if (own === undefined) {
          const suggestedUrl = config.suggestedUrls[service]
          return { service, source: "none", hasSecret: false, ...(suggestedUrl === undefined ? {} : { suggestedUrl }) }
        }
        return {
          service,
          source: "saved",
          url: own.url,
          ...(own.username === undefined ? {} : { username: own.username }),
          hasSecret: own.secret !== undefined
        }
      }

      return {
        current: Effect.map(Ref.get(saved), endpoints),
        list: Effect.map(Ref.get(saved), (all) => allServices.map((service) => setupOf(service, all))),
        save: (service, input) =>
          Effect.gen(function*() {
            if (fromEnvironment(service)) return yield* Effect.fail(setByEnvironment(service))
            const next = merged(service, input, (yield* Ref.get(saved))[service])
            if (next instanceof InvalidService) return yield* Effect.fail(next)
            yield* update(service, (all) => ({ ...all, [service]: next }))
          }),
        remove: (service) =>
          Effect.gen(function*() {
            if (fromEnvironment(service)) return yield* Effect.fail(setByEnvironment(service))
            if ((yield* Ref.get(saved))[service] === undefined) return
            yield* update(service, (all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== service)))
          }),
        changes: PubSub.subscribe(pubsub)
      } satisfies ServiceSettings["Service"]
    })

  static readonly layer = Layer.effect(
    ServiceSettings,
    Effect.gen(function*() {
      const { dataDir } = yield* HomeConfig
      return yield* ServiceSettings.make(join(dataDir, "services.json"))
    })
  )

  /** The environment's services only, nothing saved: for tests. */
  static readonly fromConfig = Layer.effect(
    ServiceSettings,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const pubsub = yield* PubSub.unbounded<HomeService>()
      const endpoints = Object.fromEntries(allServices.map((s) => [s, config[s]])) as unknown as Endpoints
      return {
        current: Effect.succeed(endpoints),
        list: Effect.succeed([]),
        save: () => Effect.die(new Error("not in this test")),
        remove: () => Effect.die(new Error("not in this test")),
        changes: PubSub.subscribe(pubsub)
      }
    })
  )
}
