import { HomeProtocol, type JournalEntry, journalPage } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { Alerts } from "@quai/domain/alerts/Alerts.ts"
import { Activities } from "@quai/domain/flows/Activities.ts"
import { FlowStore } from "@quai/domain/flows/FlowStore.ts"
import { Gone } from "@quai/domain/gone/Gone.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import { HomeError, HomeLink, offlineMessage } from "@quai/domain/home/HomeLink.ts"
import { HomeReads } from "@quai/domain/home/HomeReads.ts"
import { HomeTime } from "@quai/domain/home/HomeTime.ts"
import { IntegrationsLive } from "@quai/domain/integrations/All.ts"
import { Hub } from "@quai/domain/integrations/Hub.ts"
import type { Integrations } from "@quai/domain/integrations/Integration.ts"
import { Journal } from "@quai/domain/journal/Journal.ts"
import { Notifier } from "@quai/domain/push/Notifier.ts"
import { DiskReadings } from "@quai/domain/storage/DiskReadings.ts"
import { Effect, Layer, Option, Queue, type Scope } from "effect"
import { Socket } from "effect/socket"
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { HomeLinks } from "../src/home/HomeLinks.ts"
import { fixture } from "./fixtures.ts"

type Call = typeof HomeProtocol.Call.Type
type CloudMessageOf<Tag extends HomeProtocol.CloudMessage["_tag"]> = Extract<
  HomeProtocol.CloudMessage,
  { readonly _tag: Tag }
>
/** An answer for each message the Cloud sends, by its `_tag`. */
type Responders = {
  readonly [Tag in HomeProtocol.CloudMessage["_tag"]]: (message: CloudMessageOf<Tag>) => HomeProtocol.HomeMessage | null
}
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
export const routeOf = (call: Pick<Call, "service" | "method" | "path">) =>
  `${call.service} ${call.method} ${call.path.split("?")[0]}`

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
 * cleaner and the *arr media management setting, protocol 10 Reclaimerr's event feed, protocol 11
 * its deletion task, protocol 12 the *arr root folders.
 */
type Allowed = Pick<Call, "service" | "method" | "path">

const pathOf = (call: Allowed) => call.path.split("?")[0]!

/** Newest first: the first protocol whose rule matches the call. */
const protocolRules: ReadonlyArray<readonly [number, (call: Allowed) => boolean]> = [
  [12, (call) => pathOf(call) === "/api/v3/rootfolder"],
  [11, (call) => call.service === "reclaimerr" && pathOf(call) === "/api/v1/tasks/delete_cleanup_candidates"],
  [10, (call) => call.service === "reclaimerr" && pathOf(call) === "/api/v1/events"],
  [
    9,
    (call) =>
      /^\/api\/(v3\/config\/mediamanagement|configuration\/download_cleaner|jobs\/DownloadCleaner)$/.test(pathOf(call))
  ],
  [8, (call) =>
    call.service === "seerr" &&
    (/^\/api\/v1\/(search|user)$/.test(pathOf(call)) || (call.method === "POST" && call.path === "/api/v1/request"))],
  [6, (call) => call.service === "prowlarr" || /\/health$/.test(pathOf(call))],
  [5, (call) => call.service === "cleanuparr" || call.method === "PUT"],
  [3, (call) => call.service === "seerr" || /\/calendar$/.test(pathOf(call))],
  [2, (call) => call.service === "reclaimerr" || call.method === "DELETE"]
]

const allowedSince = (call: Allowed): number => protocolRules.find(([, matches]) => matches(call))?.[0] ?? 1

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
          : Effect.die(
            new Error(`the fake Quai Home refused what the allowlist doesn't allow: ${notAllowed.join(", ")}`)
          )
      )
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
      const answer = options.answer?.({ ...call, method: "GET", path: against.path, body: undefined }) ??
        { status: 404 }
      if (!("status" in answer || "json" in answer || "body" in answer) || (answer.status ?? 200) !== 200) return false
      const body = answer.body ?? (answer.json === undefined ? "" : JSON.stringify(answer.json))
      try {
        return against.check(JSON.parse(body), call.body)
      } catch {
        return false
      }
    }

    /** The connection cut while a call is in flight: the Cloud reads a close, the watches stop. */
    const drop = () => {
      if (state.toCloud !== null) Queue.offerUnsafe(state.toCloud, close)
      state.toCloud = null
      state.watches = []
    }

    /** What Quai Home sends back for an answer it got: nothing for a silent one or a drop. */
    const replyOf = (call: Call, answer: Answer): HomeProtocol.HomeMessage | null => {
      if ("silent" in answer) return null
      if ("drop" in answer) {
        drop()
        return null
      }
      if ("failed" in answer) return HomeProtocol.Failed.make({ id: call.id, reason: answer.failed })
      const body = answer.body ?? (answer.json === undefined ? "" : JSON.stringify(answer.json))
      return HomeProtocol.CallResponse.make({ id: call.id, status: answer.status ?? 200, body })
    }

    const runCall = (call: Call) => {
      calls.push(call)
      if (!allows(call) || !passesAgainst(call)) {
        notAllowed.push(routeOf(call))
        return HomeProtocol.Failed.make({ id: call.id, reason: "not allowed" })
      }
      return replyOf(call, options.answer?.(call) ?? { status: 404, body: "" })
    }

    // Quai Home answers a watch it refuses with Failed under the watch's id, and never polls it.
    const setWatches = (message: CloudMessageOf<"SetWatches">) => {
      for (const watch of message.watches) {
        if (!allows({ service: watch.service, method: "GET", path: watch.path })) {
          notAllowed.push(`watch ${watch.id}: ${watch.service} GET ${watch.path.split("?")[0]}`)
        }
      }
      state.watches = message.watches
      return null
    }

    /** How the fake answers each message of the Cloud, by its `_tag`. */
    const responders: Responders = {
      Challenge: (message) =>
        HomeProtocol.Proof.make({
          signature: sign(
            null,
            Buffer.from(HomeProtocol.challengePayload(message.nonce)),
            options.badProof === true ? otherKey : privateKey
          )
            .toString("base64")
        }),
      Welcome: (message) => {
        state.welcomed = message.homeId
        return null
      },
      Refused: (message) => {
        state.refused = { reason: message.reason, retryAfterSeconds: message.retryAfterSeconds }
        return null
      },
      Ping: (message) => options.deaf === true ? null : HomeProtocol.Pong.make({ at: message.at }),
      Call: runCall,
      SetWatches: setWatches,
      StoreList: (message) =>
        HomeProtocol.StoreDocuments.make({
          id: message.id,
          documents: [...documents].filter(([key]) => key.startsWith(message.prefix)).sort().map(([key, value]) => ({
            key,
            value
          }))
        }),
      StorePut: (message) => {
        documents.set(message.key, JSON.parse(JSON.stringify(message.value)))
        return HomeProtocol.StoreDone.make({ id: message.id })
      },
      StoreDelete: (message) => {
        documents.delete(message.key)
        return HomeProtocol.StoreDone.make({ id: message.id })
      },
      JournalAppend: (message) => {
        journal.push(...message.entries)
        return null
      },
      JournalRead: (message) =>
        HomeProtocol.JournalPage.make({ id: message.id, ...journalPage(journal, message.query) }),
      ConsoleResponse: (message) => {
        consoleAnswers.set(message.id, message)
        return null
      }
    }

    const respond = (message: HomeProtocol.CloudMessage): HomeProtocol.HomeMessage | null => {
      received.push(message)
      // The table gives each tag its own message; TypeScript can't follow the tag from the union.
      const responder = responders[message._tag] as (
        message: HomeProtocol.CloudMessage
      ) => HomeProtocol.HomeMessage | null
      return responder(message)
    }

    const send = (message: HomeProtocol.HomeMessage) =>
      Effect.suspend(() =>
        state.toCloud === null ? Effect.void : Effect.asVoid(Queue.offer(state.toCloud, JSON.stringify(message)))
      )

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
      yield* Queue.offer(
        toCloud,
        JSON.stringify(HomeProtocol.Hello.make({
          protocol: options.protocol ?? HomeProtocol.protocolVersion,
          homeVersion: "test",
          publicKey,
          services: options.services ?? ["radarr", "sonarr", "qbittorrent", "jellyfin"],
          ...(options.webUrls === undefined ? {} : { webUrls: options.webUrls })
        }))
      )
      yield* settle
    })

    return {
      homeId: HomeId.homeId(publicKey),
      privateKey,
      documents,
      journal,
      /** Quai Home writes a line of its own, and hands it to the Cloud's live view. */
      note: (entry: JournalEntry) =>
        Effect.andThen(
          Effect.sync(() => journal.push(entry)),
          Effect.andThen(send(HomeProtocol.JournalNoted.make({ entries: [entry] })), settle)
        ),
      calls,
      received,
      /** What the allowlist refused (calls as `routeOf`, and watches). */
      notAllowed,
      state,
      /** Connects and waits until the Cloud loaded the home. */
      connect: Effect.gen(function*() {
        yield* open
        const link = yield* Effect.flatMap(Effect.service(HomeLinks), (links) => links.link(HomeId.homeId(publicKey)))
        for (let attempt = 0; attempt < 20 && Option.isNone(yield* link.home); attempt++) yield* settle
        if (Option.isNone(yield* link.home)) {
          return yield* Effect.die(`the fake home didn't link: ${JSON.stringify(state.refused)}`)
        }
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
          send(
            HomeProtocol.WatchSnapshot.make({
              watchId,
              status,
              body: typeof body === "string" ? body : JSON.stringify(body)
            })
          ),
          settle
        ),
      /** Quai Home's poll of a watch failed. */
      failWatch: (watchId: string, reason = "unreachable") =>
        Effect.andThen(send(HomeProtocol.Failed.make({ id: watchId, reason })), settle),
      watch: (id: string) => state.watches.find((watch) => watch.id === id),
      /** Relays a request of the console Quai Home serves, and returns the Cloud's answer. */
      console: (request: Omit<HomeProtocol.ConsoleRequest, "_tag" | "id">) =>
        Effect.gen(function*() {
          const id = `c${++consoleCount}`
          yield* send(HomeProtocol.ConsoleRequest.make({ ...request, id }))
          for (let attempt = 0; attempt < 20 && !consoleAnswers.has(id); attempt++) yield* settle
          const answer = consoleAnswers.get(id)
          if (answer === undefined) {
            return yield* Effect.die(`the Cloud didn't answer ${request.method} ${request.path}`)
          }
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
 * Hub (without heartbeat: tests call `beat`), the disk readings. Needs `Apns`; `integrations` may use the link.
 */
export const cloud = <E, R>(
  integrations: Layer.Layer<Integrations, E, R>,
  link: Layer.Layer<HomeLink | HomeLinks> = testLink
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
