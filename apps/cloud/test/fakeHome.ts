import { Alerts } from "../src/alerts/Alerts.ts"
import { HomeProtocol, type JournalEntry, journalPage } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { Effect, Layer, Option, Queue, type Scope } from "effect"
import { Socket } from "effect/socket"
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { Activities } from "../src/flows/Activities.ts"
import { FlowStore } from "../src/flows/FlowStore.ts"
import { Devices } from "../src/home/Devices.ts"
import { HomeError, HomeLink, HomeLinks, offlineMessage } from "../src/home/HomeLink.ts"
import { HomeReads } from "../src/home/HomeReads.ts"
import { Hub } from "../src/integrations/Hub.ts"
import { IntegrationsLive } from "../src/integrations/All.ts"
import { Journal } from "../src/journal/Journal.ts"
import type { Integrations } from "../src/integrations/Integration.ts"
import { Notifier } from "../src/push/Notifier.ts"
import { HomeTime } from "../src/releases/HomeTime.ts"
import { fixture } from "./fixtures.ts"

type Call = typeof HomeProtocol.Call.Type
/**
 * How the fake Home answers a call: a response, a failure, nothing at all (a timeout), or the
 * connection dropped while the call is in flight.
 */
export type Answer =
  | { readonly status?: number; readonly body?: string; readonly json?: unknown }
  | { readonly failed: string }
  | { readonly silent: true }
  | { readonly drop: true }

const close = Symbol("close")

/** The fake home's key unless a test gives another: the same home in every test, `testHomeId`. */
export const testHomeKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)]),
  format: "der",
  type: "pkcs8"
})

const publicKeyOf = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64")

/** The home id of `testHomeKey`: the home the tests' `HomeLink` is to. */
export const testHomeId = HomeId.homeId(publicKeyOf(testHomeKey))

/** Links for Quai Homes, and the link to the tests' home (`testHomeId`). */
export const testLink = HomeLinks.linkOf(testHomeId)

/** Lets forked fibers run up to their next wait. */
export const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

export interface FakeHomeOptions {
  /**
   * Answers the calls the allowlist lets through (and nothing else): a recorded response, or a
   * failure. Default: 404. See `recordedHome`.
   */
  readonly answer?: (call: Call) => Answer
  /**
   * Strict (the default): a call or a watch the real allowlist refuses fails the test, at the end
   * of its scope, as well as being answered `Failed "not allowed"` like Quai Home does. Off for the
   * tests of a refusal itself.
   */
  readonly strict?: boolean
  readonly services?: ReadonlyArray<HomeProtocol.HomeService>
  /** Where an iPhone opens Radarr and Sonarr, sent in Hello. Default: none. */
  readonly webUrls?: HomeProtocol.WebUrls
  readonly protocol?: number
  /** Signs with another key than the one in Hello. */
  readonly badProof?: boolean
  /** Another home: its own key. Default: `testHomeKey`. */
  readonly privateKey?: KeyObject
  /** Doesn't answer Pings. */
  readonly deaf?: boolean
}

/** A route of a recorded Home: `"radarr GET /api/v3/queue"`, the path without its query. */
export const routeOf = (call: Pick<Call, "service" | "method" | "path">) => `${call.service} ${call.method} ${call.path.split("?")[0]}`

/** What a route answers: a fixture file (`"radarr/queue.json"`), an answer, or a function of the call. */
export type Recording = string | Answer | ((call: Call) => Answer)

/**
 * Quai Home answering from recordings: each route (`routeOf`) to what it answers; `overrides` win
 * over `routes`. Any other route answers 404.
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

/**
 * The protocol a Home first allowed this call in: an older Home refuses it as not allowed
 * (`HomeProtocol.minProtocolVersion`). Protocol 2 added Reclaimerr and `DELETE`, protocol 3 Seerr
 * and the calendars, protocol 5 Cleanuparr and `PUT`, protocol 6 Prowlarr and the *arr health
 * checks, protocol 8 Seerr's search, users and new requests, protocol 9 Cleanuparr's download
 * cleaner and the *arr media management setting.
 */
const allowedSince = (call: Pick<Call, "service" | "method" | "path">): number =>
  /^\/api\/(v3\/config\/mediamanagement|configuration\/download_cleaner|jobs\/DownloadCleaner)$/.test(call.path.split("?")[0]!)
    ? 9
    : call.service === "seerr" &&
    (/^\/api\/v1\/(search|user)$/.test(call.path.split("?")[0]!) || (call.method === "POST" && call.path === "/api/v1/request"))
    ? 8
    : call.service === "prowlarr" || /\/health$/.test(call.path.split("?")[0]!)
    ? 6
    : call.service === "cleanuparr" || call.method === "PUT"
    ? 5
    : call.service === "seerr" || /\/calendar$/.test(call.path.split("?")[0]!)
    ? 3
    : call.service === "reclaimerr" || call.method === "DELETE"
    ? 2
    : 1

/**
 * Quai Home, in memory: it says Hello with a real Ed25519 key and proves it, lets through only what
 * the real allowlist (`HomeProtocol.allowRule`, at its protocol) allows, answers calls from recorded
 * responses, keeps the home documents in a Map (that outlives connections, like its disk), and
 * lets a test push webhooks and snapshots. Talks to the real HomeLink through an in-memory socket.
 */
export const makeFakeHome = (options: FakeHomeOptions = {}) =>
  Effect.gen(function*() {
    const protocol = options.protocol ?? HomeProtocol.protocolVersion
    /** What the allowlist refused, as `routeOf` (and the watch id for a watch). */
    const notAllowed: Array<string> = []
    const allows = (request: Parameters<typeof HomeProtocol.allowRule>[0]) =>
      HomeProtocol.allowRule(request) !== undefined && allowedSince(request) <= protocol
    if (options.strict ?? true) {
      yield* Effect.addFinalizer(() =>
        notAllowed.length === 0
          ? Effect.void
          : Effect.die(new Error(`the fake Quai Home refused what the allowlist doesn't allow: ${notAllowed.join(", ")}`)))
    }
    const privateKey = options.privateKey ?? testHomeKey
    const otherKey = generateKeyPairSync("ed25519").privateKey
    const publicKey = publicKeyOf(privateKey)
    const documents = new Map<string, unknown>()
    /** Its journal, like its disk: it outlives connections. */
    const journal: Array<JournalEntry> = []
    const calls: Array<Call> = []
    const consoleAnswers = new Map<string, HomeProtocol.ConsoleResponse>()
    let consoleCount = 0
    const received: Array<HomeProtocol.CloudMessage> = []
    const state = {
      watches: [] as ReadonlyArray<HomeProtocol.Watch>,
      refused: null as { readonly reason: string; readonly retryAfterSeconds: number } | null,
      welcomed: null as string | null,
      closed: false,
      toCloud: null as Queue.Queue<string | typeof close> | null
    }

    /**
     * A write checked against what the service holds, as Quai Home does: its rule's GET, answered
     * like any call (but not recorded among the calls), then the rule's check.
     */
    const passesAgainst = (call: Call): boolean => {
      const against = HomeProtocol.allowRule(call)?.against
      if (against === undefined) return true
      const answer = options.answer?.({ ...call, method: "GET", path: against.path, body: undefined }) ?? { status: 404 }
      if (!("status" in answer || "json" in answer || "body" in answer) || (answer.status ?? 200) !== 200) return false
      const body = answer.body ?? (answer.json === undefined ? "" : JSON.stringify(answer.json))
      try {
        return against.check(JSON.parse(body), call.body)
      } catch {
        return false
      }
    }

    const respond = (message: HomeProtocol.CloudMessage): HomeProtocol.HomeMessage | null => {
      received.push(message)
      switch (message._tag) {
        case "Challenge":
          return HomeProtocol.Proof.make({
            signature: sign(null, Buffer.from(HomeProtocol.challengePayload(message.nonce)), options.badProof === true ? otherKey : privateKey)
              .toString("base64")
          })
        case "Welcome":
          state.welcomed = message.homeId
          return null
        case "Refused":
          state.refused = { reason: message.reason, retryAfterSeconds: message.retryAfterSeconds }
          return null
        case "Ping":
          return options.deaf === true ? null : HomeProtocol.Pong.make({ at: message.at })
        case "Call": {
          calls.push(message)
          if (!allows(message) || !passesAgainst(message)) {
            notAllowed.push(routeOf(message))
            return HomeProtocol.Failed.make({ id: message.id, reason: "not allowed" })
          }
          const answer = options.answer?.(message) ?? { status: 404, body: "" }
          if ("silent" in answer) return null
          if ("drop" in answer) {
            if (state.toCloud !== null) Queue.offerUnsafe(state.toCloud, close)
            state.toCloud = null
            state.watches = []
            return null
          }
          if ("failed" in answer) return HomeProtocol.Failed.make({ id: message.id, reason: answer.failed })
          const body = answer.body ?? (answer.json === undefined ? "" : JSON.stringify(answer.json))
          return HomeProtocol.CallResponse.make({ id: message.id, status: answer.status ?? 200, body })
        }
        case "SetWatches":
          // Quai Home answers a watch it refuses with Failed under the watch's id, and never polls it.
          for (const watch of message.watches) {
            if (!allows({ service: watch.service, method: "GET", path: watch.path })) notAllowed.push(`watch ${watch.id}: ${watch.service} GET ${watch.path.split("?")[0]}`)
          }
          state.watches = message.watches
          return null
        case "StoreList":
          return HomeProtocol.StoreDocuments.make({
            id: message.id,
            documents: [...documents].filter(([k]) => k.startsWith(message.prefix)).sort().map(([key, value]) => ({ key, value }))
          })
        case "StorePut":
          documents.set(message.key, JSON.parse(JSON.stringify(message.value)))
          return HomeProtocol.StoreDone.make({ id: message.id })
        case "StoreDelete":
          documents.delete(message.key)
          return HomeProtocol.StoreDone.make({ id: message.id })
        case "JournalAppend":
          journal.push(...message.entries)
          return null
        case "JournalRead":
          return HomeProtocol.JournalPage.make({ id: message.id, ...journalPage(journal, message.query) })
        case "ConsoleResponse":
          consoleAnswers.set(message.id, message)
          return null
      }
    }

    const send = (message: HomeProtocol.HomeMessage) =>
      Effect.suspend(() => state.toCloud === null ? Effect.void : Effect.asVoid(Queue.offer(state.toCloud, JSON.stringify(message))))

    /** Opens a connection: the link serves it in the background. Settles before returning. */
    const open: Effect.Effect<void, never, HomeLinks | Scope.Scope> = Effect.gen(function*() {
      const links = yield* HomeLinks
      const toCloud = yield* Queue.unbounded<string | typeof close>()
      state.toCloud = toCloud
      state.closed = false
      state.watches = []
      const socket = Socket.make({
        reader: Effect.succeed({
          pull: Effect.flatMap(Queue.take(toCloud), (frame) =>
            frame === close
              ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))
              : Effect.succeed([frame] as const)),
          upgrade: Socket.SocketUpgradeError.unsupported
        }),
        writer: Effect.succeed({
          write: (chunk) =>
            Effect.suspend(() => {
              if (Socket.isCloseEvent(chunk)) {
                state.closed = true
                return Effect.void
              }
              const reply = respond(JSON.parse(String(chunk)))
              return reply === null ? Effect.void : Effect.asVoid(Queue.offer(toCloud, JSON.stringify(reply)))
            }),
          writeAll: () => Effect.void
        })
      })
      yield* Effect.forkScoped(links.serve(socket))
      yield* Queue.offer(toCloud, JSON.stringify(HomeProtocol.Hello.make({
        protocol: options.protocol ?? HomeProtocol.protocolVersion,
        homeVersion: "test",
        publicKey,
        services: options.services ?? ["radarr", "sonarr", "qbittorrent", "jellyfin"],
        ...(options.webUrls === undefined ? {} : { webUrls: options.webUrls })
      })))
      yield* settle
    })

    return {
      homeId: HomeId.homeId(publicKey),
      privateKey,
      documents,
      journal,
      /** Quai Home writes a line of its own, and hands it to the Cloud's live view. */
      note: (entry: JournalEntry) =>
        Effect.andThen(Effect.sync(() => journal.push(entry)), Effect.andThen(send(HomeProtocol.JournalNoted.make({ entries: [entry] })), settle)),
      calls,
      received,
      /** What the allowlist refused (calls as `routeOf`, and watches). */
      notAllowed,
      state,
      /** Connects and waits until the Cloud loaded the home. */
      connect: Effect.gen(function*() {
        yield* open
        const link = yield* Effect.flatMap(Effect.service(HomeLinks), (links) => links.link(HomeId.homeId(publicKey)))
        for (let i = 0; i < 20 && Option.isNone(yield* link.home); i++) yield* settle
        if (Option.isNone(yield* link.home)) return yield* Effect.die(`the fake home didn't link: ${JSON.stringify(state.refused)}`)
      }),
      /** Connects and stops there, whatever the Cloud says. */
      open,
      /** Drops the connection, as a network cut. */
      disconnect: Effect.gen(function*() {
        if (state.toCloud !== null) yield* Queue.offer(state.toCloud, close)
        state.toCloud = null
        // Quai Home stops polling with the connection.
        state.watches = []
        yield* settle
      }),
      webhook: (service: HomeProtocol.HomeService, body: unknown) =>
        Effect.andThen(send(HomeProtocol.WebhookReceived.make({ service, receivedAt: 0, body })), settle),
      snapshot: (watchId: string, body: unknown, status = 200) =>
        Effect.andThen(
          send(HomeProtocol.WatchSnapshot.make({ watchId, status, body: typeof body === "string" ? body : JSON.stringify(body) })),
          settle
        ),
      /** Quai Home's poll of a watch failed. */
      failWatch: (watchId: string, reason = "unreachable") => Effect.andThen(send(HomeProtocol.Failed.make({ id: watchId, reason })), settle),
      watch: (id: string) => state.watches.find((w) => w.id === id),
      /** Relays a request of the console Quai Home serves, and returns the Cloud's answer. */
      console: (request: Omit<HomeProtocol.ConsoleRequest, "_tag" | "id">) =>
        Effect.gen(function*() {
          const id = `c${++consoleCount}`
          yield* send(HomeProtocol.ConsoleRequest.make({ ...request, id }))
          for (let i = 0; i < 20 && !consoleAnswers.has(id); i++) yield* settle
          const answer = consoleAnswers.get(id)
          if (answer === undefined) return yield* Effect.die(`the Cloud didn't answer ${request.method} ${request.path}`)
          return { status: answer.status, json: answer.body === "" ? undefined : JSON.parse(answer.body) as unknown }
        }),
      /** A service was set or removed from Quai Home's console. */
      servicesChanged: (services: ReadonlyArray<HomeProtocol.HomeService>) =>
        Effect.andThen(send(HomeProtocol.ServicesChanged.make({ services })), settle)
    }
  })

export type FakeHome = Effect.Success<ReturnType<typeof makeFakeHome>>

/**
 * Quai Cloud without its HTTP server: the home link, the home's data on it, the engine and the
 * Hub (without heartbeat: tests call `beat`). Needs `Apns`; `integrations` may use the link.
 */
export const cloud = <E, R>(integrations: Layer.Layer<Integrations, E, R>, link: Layer.Layer<HomeLink | HomeLinks> = testLink) =>
  Hub.layerFed.pipe(
    Layer.provideMerge(Layer.mergeAll(Notifier.layer, Alerts.layer)),
    Layer.provideMerge(Layer.mergeAll(Activities.layer, HomeTime.layer)),
    Layer.provideMerge(Layer.mergeAll(Devices.layer, FlowStore.layer, integrations)),
    Layer.provideMerge(Layer.mergeAll(HomeLink.documents, HomeReads.layer)),
    Layer.provideMerge(Journal.layer),
    Layer.provideMerge(link)
  )

/**
 * The real link, but the calls of these routes (`routeOf`) find Quai Home gone, as if it dropped
 * during the call and was back by the next one: the documents and the other calls still answer.
 */
export const linkDroppingOn = (...routes: ReadonlyArray<string>) =>
  Layer.effect(
    HomeLink,
    Effect.map(Effect.flatMap(Effect.service(HomeLinks), (links) => links.link(testHomeId)), (link) =>
      HomeLink.of({
        ...link,
        call: (request, options) =>
          routes.includes(routeOf(request))
            ? Effect.fail(new HomeError({ reason: "offline", message: offlineMessage }))
            : link.call(request, options)
      }))
  ).pipe(Layer.provideMerge(HomeLinks.layer))

/** With the real integrations. */
export const cloudLive = cloud(IntegrationsLive)
