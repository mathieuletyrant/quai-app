import { HomeOffline, HomeRequired, type JournalEntry, type JournalQuery, type Service } from "@quai/api"
import { Context, Data, Effect, Layer, Option } from "effect"

type HomeService = Service

/** What the app and the console are told while no Quai Home is connected. */
export const offlineMessage = "Quai Home is not connected"

/** Quai Home isn't connected, didn't answer in time, or answered with a failure. */
export class HomeError extends Data.TaggedError("HomeError")<{
  readonly reason: "offline" | "timeout" | "failed"
  readonly message: string
}> {}

/** A HomeError as the API reports it: 503. */
export const toOffline = (error: HomeError) =>
  new HomeOffline({ message: error.reason === "offline" ? offlineMessage : `Quai Home: ${error.message}` })

/** Where an iPhone opens Radarr's and Sonarr's own pages, at home first, then from outside: the app's links to a title. */
export interface WebUrls {
  readonly radarr?: ReadonlyArray<string>
  readonly sonarr?: ReadonlyArray<string>
}

/** The home, once it is up. */
export interface LinkedHome {
  readonly homeId: string
  /** The services Quai Home reaches (a URL and a key set). */
  readonly services: ReadonlyArray<HomeService>
  readonly webUrls?: WebUrls
}

/** What Quai Home tells, in the order it told it. */
export type HomeEvent =
  | { readonly _tag: "Ready"; readonly home: LinkedHome }
  /** The services Quai Home reaches changed (set from its console), on the same connection. */
  | { readonly _tag: "Services"; readonly home: LinkedHome }
  | { readonly _tag: "Gone"; readonly homeId: string }
  | { readonly _tag: "Snapshot"; readonly watchId: string; readonly status: number; readonly body: string }
  | { readonly _tag: "WatchFailed"; readonly watchId: string; readonly reason: string }
  | { readonly _tag: "Webhook"; readonly service: HomeService; readonly receivedAt: number; readonly body: unknown }
  /** Lines Quai Home wrote to its journal itself. */
  | { readonly _tag: "Journal"; readonly entries: ReadonlyArray<JournalEntry> }

export interface HomeDocument {
  readonly key: string
  readonly value: unknown
}

export type CallMethod = "GET" | "POST" | "PUT" | "DELETE"

/** One HTTP call to a service: a button press, or a one-off read. */
export interface CallRequest {
  readonly service: HomeService
  readonly method: CallMethod
  /** Path and query, as the service expects them: `/api/v2/torrents/info?hashes=a|b`. */
  readonly path: string
  /** Sent as JSON. */
  readonly body?: unknown
}

/** A GET Quai Home polls, sending a snapshot each time its answer changes. */
export interface Watch {
  readonly id: string
  readonly service: HomeService
  readonly path: string
  /** Between `minWatchSeconds` and `maxWatchSeconds`. */
  readonly everySeconds: number
}

export const minWatchSeconds = 5
export const maxWatchSeconds = 3600

/**
 * Keys of home documents: lowercase segments separated by slashes (`flows/download`), lowercase so
 * they can't collide on a case-insensitive disk. A key and a folder may share a name (`flows` and
 * `flows/download`): they are separate documents, and listing `flows` returns both.
 */
export const isStoreKey = (key: string) =>
  /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(key) && key.length <= 200

/** A request of the console, which Quai Home serves: answered by the domain's routes. */
export interface ConsoleRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE"
  /** Path and query: `/console-api/journal?limit=50`. */
  readonly path: string
  /** JSON, as the console sent it. */
  readonly body?: string
}

/** What the console asks the domain for: its `/console-api` routes and its health. */
export const isConsolePath = (path: string) => {
  const route = path.split("?")[0]!
  return !route.includes("..") && (route.startsWith("/console-api/") || route === "/api/health")
}
export type ConsoleHandler = (
  request: ConsoleRequest
) => Effect.Effect<{ readonly status: number; readonly body: string }>

/**
 * The home's documents (paired iPhones, flows, activities), as Quai Home keeps them on its disk: a
 * write returns once it is there.
 */
export class HomeDocuments extends Context.Service<HomeDocuments, {
  /** Whose documents these are. */
  readonly homeId: string
  readonly get: (key: string) => Effect.Effect<Option.Option<unknown>, HomeError>
  /** Every document whose key starts with `prefix`, sorted by key. */
  readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<HomeDocument>, HomeError>
  readonly put: (key: string, value: unknown) => Effect.Effect<void, HomeError>
  readonly delete: (key: string) => Effect.Effect<void, HomeError>
}>()("quai/HomeDocuments") {
  /** Always connected, kept in memory: for tests of what sits on top. */
  static readonly memory = Layer.sync(HomeDocuments, () => {
    const documents = new Map<string, unknown>()
    return {
      homeId: memoryHomeId,
      ...makeDocuments(Effect.succeed(documents), (key, value) =>
        Effect.sync(() => {
          if (value === undefined) documents.delete(key)
          else documents.set(key, value)
        }))
    }
  })
}

/** A copy as it would come back from disk: what is cached is what a restarted Quai Home would read. */
const asStored = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null")

/** The home `HomeDocuments.memory` keeps documents for. */
export const memoryHomeId = "0".repeat(32)

/** The documents of a home, read from `documents` and written with `write`. */
export const makeDocuments = (
  documents: Effect.Effect<Map<string, unknown>, HomeError>,
  write: (key: string, value: unknown | undefined) => Effect.Effect<void, HomeError>
): Omit<HomeDocuments["Service"], "homeId"> => {
  const checked = (key: string) =>
    isStoreKey(key) ? Effect.void : Effect.die(new Error(`invalid home document key: ${key}`))
  return {
    get: (key) => Effect.map(documents, (all) => Option.fromNullishOr(all.get(key))),
    list: (prefix) =>
      Effect.map(
        documents,
        (all) =>
          [...all].filter(([key]) => key.startsWith(prefix)).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
            .map(([key, value]) => ({ key, value }))
      ),
    put: (key, value) => Effect.andThen(checked(key), write(key, asStored(value))),
    delete: (key) => Effect.andThen(checked(key), write(key, undefined))
  }
}

/**
 * The domain's way to its home: the calls to the services, the watches, the documents, the
 * journal, and what comes on its own (snapshots, webhooks), as events. Quai Home answers it in
 * place (`LocalHome`); the tests with a fake home.
 */
export class HomeLink extends Context.Service<HomeLink, {
  /** The home this link is to. */
  readonly homeId: string
  /** The home, once it is up; None while it isn't. */
  readonly home: Effect.Effect<Option.Option<LinkedHome>>
  /** One HTTP call to a service. `timeoutMs` for the slow ones (a release search). */
  readonly call: (
    request: CallRequest,
    options?: { readonly timeoutMs?: number }
  ) => Effect.Effect<{ readonly status: number; readonly body: string }, HomeError>
  /** Replaces what Quai Home polls. */
  readonly setWatches: (watches: ReadonlyArray<Watch>) => Effect.Effect<void, HomeError>
  /** Hands Quai Home lines for its journal. */
  readonly appendJournal: (entries: ReadonlyArray<JournalEntry>) => Effect.Effect<void, HomeError>
  /** A page of the journal Quai Home keeps. */
  readonly readJournal: (
    query: JournalQuery
  ) => Effect.Effect<{ readonly entries: ReadonlyArray<JournalEntry>; readonly more: boolean }, HomeError>
  readonly documents: HomeDocuments["Service"]
  /** The next event from the home. One reader: the Hub. */
  readonly nextEvent: Effect.Effect<HomeEvent>
  /** Answers the console's requests (its console is served by Quai Home). Until set, 503. */
  readonly answerConsole: (handler: ConsoleHandler) => Effect.Effect<void>
}>()("quai/HomeLink") {
  /** A link to no home: always offline, never an event. */
  static readonly offline: HomeLink["Service"] = (() => {
    const offline = Effect.fail(new HomeError({ reason: "offline", message: offlineMessage }))
    return {
      homeId: "",
      home: Effect.succeed(Option.none()),
      call: () => offline,
      setWatches: () => offline,
      appendJournal: () => offline,
      readJournal: () => offline,
      documents: { homeId: "", ...makeDocuments(offline, () => offline) },
      nextEvent: Effect.never,
      answerConsole: () => Effect.void
    }
  })()

  /** The home's documents. */
  static readonly documents = Layer.effect(
    HomeDocuments,
    Effect.map(Effect.service(HomeLink), (link) => link.documents)
  )
}

/** The API's routes that need the home: 503 while it isn't up. */
export const HomeRequiredLive = Layer.effect(
  HomeRequired,
  Effect.gen(function*() {
    const link = yield* HomeLink
    const connected = Effect.flatMap(
      link.home,
      (home) => Option.isSome(home) ? Effect.void : Effect.fail(new HomeOffline({ message: offlineMessage }))
    )
    return (httpEffect) => Effect.andThen(connected, httpEffect)
  })
)
