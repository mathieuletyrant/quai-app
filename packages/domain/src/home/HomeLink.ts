import { HomeOffline, HomeProtocol, HomeRequired, type JournalEntry, type JournalQuery } from "@quai/api"
import { Context, Data, Effect, Layer, Option } from "effect"

type HomeService = HomeProtocol.HomeService

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

/** A home Quai Cloud serves, once its documents are loaded. */
export interface LinkedHome {
  readonly homeId: string
  /** The services this Quai Home reaches (from its Hello). */
  readonly services: ReadonlyArray<HomeService>
  /** The protocol it speaks (from its Hello): what it can do, `journalProtocolVersion` and up a journal. */
  readonly protocol: number
  /** Where an iPhone opens Radarr and Sonarr (from its Hello), at home first. */
  readonly webUrls?: HomeProtocol.WebUrls
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

export type CallRequest = Omit<HomeProtocol.Call, "_tag" | "id">

/** A console request Quai Home relays, and what answers it: the Cloud's own routes. */
export type ConsoleRequest = Omit<HomeProtocol.ConsoleRequest, "_tag" | "id">
export type ConsoleHandler = (
  request: ConsoleRequest
) => Effect.Effect<{ readonly status: number; readonly body: string }>

/**
 * The home's documents (paired iPhones, flows, activities), as Quai Home keeps them. Quai Cloud
 * holds them in memory while the home is connected and writes every change back: a write returns
 * once Quai Home said it is on disk.
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

/** A copy as it would come back from disk: what is cached is what a restarted Cloud would read. */
const asStored = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null")

/** The home `HomeDocuments.memory` keeps documents for. */
export const memoryHomeId = "0".repeat(32)

/** The documents of a home, read from `documents` and written with `write`. */
export const makeDocuments = (
  documents: Effect.Effect<Map<string, unknown>, HomeError>,
  write: (key: string, value: unknown | undefined) => Effect.Effect<void, HomeError>
): Omit<HomeDocuments["Service"], "homeId"> => {
  const checked = (key: string) =>
    HomeProtocol.isStoreKey(key) ? Effect.void : Effect.die(new Error(`invalid home document key: ${key}`))
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
 * The link to one home's Quai Home: the calls and store operations Quai Cloud sends it, and what
 * it sends on its own (snapshots, webhooks), as events. Every service of a home reads its own link
 * (see `Homes`): it never sees another home.
 */
export class HomeLink extends Context.Service<HomeLink, {
  /** The home this link is to. */
  readonly homeId: string
  /** The home, once its documents are loaded; None while its Quai Home isn't connected. */
  readonly home: Effect.Effect<Option.Option<LinkedHome>>
  /**
   * One HTTP call to a service, through Quai Home's allowlist. `timeoutMs` for the slow ones (a
   * release search): a little longer than Quai Home itself waits for the service.
   */
  readonly call: (
    request: CallRequest,
    options?: { readonly timeoutMs?: number }
  ) => Effect.Effect<{ readonly status: number; readonly body: string }, HomeError>
  /** Replaces what Quai Home polls. */
  readonly setWatches: (watches: ReadonlyArray<HomeProtocol.Watch>) => Effect.Effect<void, HomeError>
  /** Hands Quai Home lines for its journal, unanswered. Only to a Home at `journalProtocolVersion` or later. */
  readonly appendJournal: (entries: ReadonlyArray<JournalEntry>) => Effect.Effect<void, HomeError>
  /** A page of the journal Quai Home keeps. */
  readonly readJournal: (
    query: JournalQuery
  ) => Effect.Effect<{ readonly entries: ReadonlyArray<JournalEntry>; readonly more: boolean }, HomeError>
  readonly documents: HomeDocuments["Service"]
  /** The next event from Quai Home. One reader: the Hub. */
  readonly nextEvent: Effect.Effect<HomeEvent>
  /** Answers the console requests Quai Home relays (its console is served there). Until set, 503. */
  readonly answerConsole: (handler: ConsoleHandler) => Effect.Effect<void>
}>()("quai/HomeLink") {
  /** A link to no home: always offline, never an event. What answers a request no home is found for. */
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

/** The API's routes that need the home: 503 while it isn't connected. */
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
