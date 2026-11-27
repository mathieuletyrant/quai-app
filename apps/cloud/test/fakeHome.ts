import { type HomeProtocol, type JournalEntry, journalPage } from "@quai/api"
import { Alerts } from "@quai/domain/alerts/Alerts.ts"
import { Activities } from "@quai/domain/flows/Activities.ts"
import { FlowStore } from "@quai/domain/flows/FlowStore.ts"
import { Gone } from "@quai/domain/gone/Gone.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import {
  type CallRequest,
  type ConsoleHandler,
  type ConsoleRequest,
  HomeError,
  type HomeEvent,
  HomeLink,
  type LinkedHome,
  makeDocuments,
  offlineMessage,
  type Watch,
  type WebUrls
} from "@quai/domain/home/HomeLink.ts"
import { HomeReads } from "@quai/domain/home/HomeReads.ts"
import { HomeTime } from "@quai/domain/home/HomeTime.ts"
import { IntegrationsLive } from "@quai/domain/integrations/All.ts"
import { Hub } from "@quai/domain/integrations/Hub.ts"
import type { Integrations } from "@quai/domain/integrations/Integration.ts"
import { Journal } from "@quai/domain/journal/Journal.ts"
import { Notifier } from "@quai/domain/push/Notifier.ts"
import { DiskReadings } from "@quai/domain/storage/DiskReadings.ts"
import { Context, Effect, Layer, Option, Queue } from "effect"
import { fixture } from "./fixtures.ts"

/** One call the domain made to a service, as the fake home got it. */
export type Call = CallRequest

/**
 * How the fake home answers a call: a response (`afterMs` later, for a slow one), a failure,
 * nothing at all (a timeout), or the home gone while the call is in flight.
 */
export type Answer =
  | { readonly status?: number; readonly body?: string; readonly json?: unknown; readonly afterMs?: number }
  | { readonly failed: string }
  | { readonly silent: true }
  | { readonly drop: true }

/** What the domain did on its link, in order: what a test reads to see what it asked of its home. */
export type LinkUse =
  | ({ readonly _tag: "Call" } & Call)
  | { readonly _tag: "SetWatches"; readonly watches: ReadonlyArray<Watch> }
  | { readonly _tag: "StorePut"; readonly key: string; readonly value: unknown }
  | { readonly _tag: "StoreDelete"; readonly key: string }
  | { readonly _tag: "JournalAppend"; readonly entries: ReadonlyArray<JournalEntry> }
  | { readonly _tag: "JournalRead" }

/** The home the tests' link is to: the same in every test. */
export const testHomeId = "7".repeat(32)

/** How long a call waits for a silent answer, unless the domain says otherwise. */
export const callTimeoutMs = 15_000

/** Lets forked fibers run up to their next wait. */
export const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

export interface FakeHomeOptions {
  /** Answers the domain's calls: a recorded response, or a failure. Default: 404. See `recordedHome`. */
  readonly answer?: (call: Call) => Answer
  readonly services?: ReadonlyArray<HomeProtocol.HomeService>
  /** Where an iPhone opens Radarr and Sonarr. Default: none. */
  readonly webUrls?: WebUrls
}

/** A route of a recorded home: `"radarr GET /api/v3/queue"`, the path without its query. */
export const routeOf = (call: Pick<Call, "service" | "method" | "path">) =>
  `${call.service} ${call.method} ${call.path.split("?")[0]}`

/** What a route answers: a fixture file (`"radarr/queue.json"`), an answer, or a function of the call. */
export type Recording = string | Answer | ((call: Call) => Answer)

/**
 * A home answering from recordings: each route (`routeOf`) to what it answers; `overrides` win over
 * `routes`. Any other route answers 404.
 */
export const recordedHome = (
  routes: Readonly<Record<string, Recording>>,
  overrides: Readonly<Record<string, Recording>> = {}
) =>
(call: Call): Answer => {
  const route = routeOf(call)
  const recording = Object.hasOwn(overrides, route) ? overrides[route] : routes[route]
  if (recording === undefined) return { status: 404 }
  if (typeof recording === "string") return { json: fixture(recording) }
  return typeof recording === "function" ? recording(call) : recording
}

/** What the tests' link reads of the fake home up now. */
interface UpHome {
  readonly documents: Map<string, unknown>
  readonly journal: Array<JournalEntry>
  readonly calls: Array<Call>
  readonly received: Array<LinkUse>
  readonly state: { watches: ReadonlyArray<Watch> }
  readonly answer: (call: Call) => Answer
  readonly linked: () => LinkedHome
  readonly disconnect: Effect.Effect<void>
}

/** The fake home behind the tests' link, while one is up. */
interface Slot {
  current: UpHome | null
  readonly events: Queue.Queue<HomeEvent>
  consoleHandler: ConsoleHandler | null
}

/** Where the tests' link finds its fake home: the one that connected last. */
export class FakeLinks extends Context.Service<FakeLinks, Slot>()("quai-test/FakeLinks") {}

/**
 * Quai Home, in memory: the domain's link answered from recorded responses, its documents in a Map
 * and its journal in an array (that outlive a disconnection, like its disk), and what a test makes
 * it say on its own (webhooks, snapshots, lines of its own journal). `received` lists what the
 * domain did on the link.
 */
export const makeFakeHome = (options: FakeHomeOptions = {}) =>
  Effect.sync(() => {
    const documents = new Map<string, unknown>()
    /** Its journal, like its disk: it outlives disconnections. */
    const journal: Array<JournalEntry> = []
    const calls: Array<Call> = []
    const received: Array<LinkUse> = []
    const state = {
      watches: [] as ReadonlyArray<Watch>,
      services: options.services ?? ["radarr", "sonarr", "qbittorrent", "jellyfin"],
      slot: null as Slot | null
    }

    const linked = (): LinkedHome => ({
      homeId: testHomeId,
      services: state.services,
      ...(options.webUrls === undefined ? {} : { webUrls: options.webUrls })
    })
    /** What the home says on its own reaches the domain only while it is up. */
    const tell = (event: HomeEvent) =>
      Effect.andThen(
        Effect.suspend(() => state.slot === null ? Effect.void : Queue.offer(state.slot.events, event)),
        settle
      )

    const home = {
      homeId: testHomeId,
      documents,
      journal,
      calls,
      received,
      state,
      answer: (call: Call): Answer => options.answer?.(call) ?? { status: 404, body: "" },
      /** Connects to the tests' link and tells the domain the home is up. */
      connect: Effect.gen(function*() {
        const slot = yield* FakeLinks
        if (slot.current !== null && slot.current !== home) {
          yield* Queue.offer(slot.events, { _tag: "Gone", homeId: testHomeId })
        }
        slot.current = home
        state.slot = slot
        state.watches = []
        yield* Queue.offer(slot.events, { _tag: "Ready", home: linked() })
        yield* settle
      }),
      /** The home goes away: the domain hears it, its watches stop. */
      disconnect: Effect.gen(function*() {
        const slot = state.slot
        if (slot === null) return
        state.slot = null
        state.watches = []
        if (slot.current === home) slot.current = null
        yield* Queue.offer(slot.events, { _tag: "Gone", homeId: testHomeId })
        yield* settle
      }),
      linked,
      /** Quai Home writes a line of its own, and hands it to the journal's live view. */
      note: (entry: JournalEntry) =>
        Effect.andThen(Effect.sync(() => journal.push(entry)), tell({ _tag: "Journal", entries: [entry] })),
      webhook: (service: HomeProtocol.HomeService, body: unknown) =>
        tell({ _tag: "Webhook", service, receivedAt: 0, body }),
      snapshot: (watchId: string, body: unknown, status = 200) =>
        tell({ _tag: "Snapshot", watchId, status, body: typeof body === "string" ? body : JSON.stringify(body) }),
      /** Quai Home's poll of a watch failed. */
      failWatch: (watchId: string, reason = "unreachable") => tell({ _tag: "WatchFailed", watchId, reason }),
      watch: (id: string) => state.watches.find((watch) => watch.id === id),
      /** A request of the console Quai Home serves, answered by the domain's routes. */
      console: (request: ConsoleRequest) =>
        Effect.gen(function*() {
          const handler = state.slot?.consoleHandler ?? null
          if (handler === null) {
            return yield* Effect.die(`nothing answers the console: ${request.method} ${request.path}`)
          }
          const answer = yield* handler(request)
          return { status: answer.status, json: answer.body === "" ? undefined : JSON.parse(answer.body) as unknown }
        }),
      /** A service was set or removed from Quai Home's console. */
      servicesChanged: (services: ReadonlyArray<HomeProtocol.HomeService>) =>
        Effect.andThen(Effect.sync(() => (state.services = services)), tell({ _tag: "Services", home: linked() }))
    }
    return home
  })

export type FakeHome = Effect.Success<ReturnType<typeof makeFakeHome>>

const offline = () => Effect.fail(new HomeError({ reason: "offline", message: offlineMessage }))

/** The body of an answer, as the service would have sent it. */
const bodyOf = (answer: { readonly body?: string; readonly json?: unknown }) =>
  answer.body ?? (answer.json === undefined ? "" : JSON.stringify(answer.json))

/** The domain's call, answered by the fake home up now. */
const callOn = (
  home: UpHome,
  call: Call,
  timeoutMs: number
): Effect.Effect<{ readonly status: number; readonly body: string }, HomeError> =>
  Effect.gen(function*() {
    home.calls.push(call)
    home.received.push({ _tag: "Call", ...call })
    const answer = home.answer(call)
    if ("silent" in answer) {
      yield* Effect.sleep(timeoutMs)
      return yield* Effect.fail(new HomeError({ reason: "timeout", message: "Quai Home didn't answer in time" }))
    }
    if ("drop" in answer) {
      yield* home.disconnect
      return yield* offline()
    }
    if ("failed" in answer) return yield* Effect.fail(new HomeError({ reason: "failed", message: answer.failed }))
    if (answer.afterMs !== undefined) yield* Effect.sleep(answer.afterMs)
    return { status: answer.status ?? 200, body: bodyOf(answer) }
  })

/** The tests' `HomeLink`, to whatever fake home is up (`FakeHome.connect`); offline while none is. */
const linkOn = (slot: Slot): HomeLink["Service"] => {
  const current = Effect.suspend(() => slot.current === null ? offline() : Effect.succeed(slot.current))
  return {
    homeId: testHomeId,
    home: Effect.sync(() => slot.current === null ? Option.none() : Option.some(slot.current.linked())),
    call: (call, options) => Effect.flatMap(current, (home) => callOn(home, call, options?.timeoutMs ?? callTimeoutMs)),
    setWatches: (watches) =>
      Effect.map(current, (home) => {
        home.received.push({ _tag: "SetWatches", watches })
        home.state.watches = watches
      }),
    appendJournal: (entries) =>
      Effect.map(current, (home) => {
        home.received.push({ _tag: "JournalAppend", entries })
        home.journal.push(...entries)
      }),
    readJournal: (query) =>
      Effect.map(current, (home) => {
        home.received.push({ _tag: "JournalRead" })
        return journalPage(home.journal, query)
      }),
    documents: {
      homeId: testHomeId,
      ...makeDocuments(
        Effect.map(current, (home) => home.documents as Map<string, unknown>),
        (key, value) =>
          Effect.map(current, (home) => {
            if (value === undefined) {
              home.received.push({ _tag: "StoreDelete", key })
              home.documents.delete(key)
            } else {
              home.received.push({ _tag: "StorePut", key, value })
              home.documents.set(key, value)
            }
          })
      )
    },
    nextEvent: Queue.take(slot.events),
    answerConsole: (handler) => Effect.sync(() => (slot.consoleHandler = handler))
  }
}

const slotLayer = Layer.effect(
  FakeLinks,
  Effect.map(Queue.unbounded<HomeEvent>(), (events): Slot => ({ current: null, events, consoleHandler: null }))
)

/** The link to the tests' fake home, and where it connects (`FakeLinks`). */
export const testLink: Layer.Layer<HomeLink | FakeLinks> = Layer.effect(
  HomeLink,
  Effect.map(Effect.service(FakeLinks), linkOn)
).pipe(Layer.provideMerge(slotLayer))

/**
 * The tests' link, but the calls of these routes (`routeOf`) find the home gone, as if it dropped
 * during the call and was back by the next one: the documents and the other calls still answer.
 */
export const linkDroppingOn = (...routes: ReadonlyArray<string>): Layer.Layer<HomeLink | FakeLinks> =>
  Layer.effect(
    HomeLink,
    Effect.map(Effect.service(FakeLinks), (slot) => {
      const link = linkOn(slot)
      return HomeLink.of({
        ...link,
        call: (request, options) => routes.includes(routeOf(request)) ? offline() : link.call(request, options)
      })
    })
  ).pipe(Layer.provideMerge(slotLayer))

/**
 * The domain without its HTTP routes: the home link, the home's data on it, the engine and the Hub
 * (without heartbeat: tests call `beat`), the disk readings. Needs `Apns`; `integrations` may use the link.
 */
export const cloud = <E, R>(
  integrations: Layer.Layer<Integrations, E, R>,
  link: Layer.Layer<HomeLink | FakeLinks> = testLink
) =>
  Hub.layerFed.pipe(
    Layer.provideMerge(Layer.mergeAll(Notifier.layer, Alerts.layer, Gone.layer)),
    Layer.provideMerge(Layer.mergeAll(Activities.layer, integrations)),
    Layer.provideMerge(DiskReadings.layer),
    Layer.provideMerge(HomeTime.layer),
    Layer.provideMerge(Layer.mergeAll(Devices.layer, FlowStore.layer)),
    Layer.provideMerge(Layer.mergeAll(HomeLink.documents, HomeReads.layer)),
    Layer.provideMerge(Journal.layer),
    Layer.provideMerge(link)
  )

/** With the real integrations. */
export const cloudLive = cloud(IntegrationsLive)
