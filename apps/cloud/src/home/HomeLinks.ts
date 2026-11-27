import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import {
  type ConsoleHandler,
  type ConsoleRequest,
  HomeError,
  type HomeEvent,
  HomeLink,
  makeDocuments,
  offlineMessage
} from "@quai/domain/home/HomeLink.ts"
import { Clock, Config, Context, Deferred, Effect, Layer, Option, Queue, Ref, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { createPublicKey, randomBytes, verify } from "node:crypto"

type HomeMessage = HomeProtocol.HomeMessage
type CloudMessage = HomeProtocol.CloudMessage
type HomeService = HomeProtocol.HomeService
type Answer = Extract<
  HomeMessage,
  { readonly _tag: "CallResponse" | "Failed" | "StoreDocuments" | "StoreDone" | "JournalPage" }
>

const HomeJson = Schema.fromJsonString(HomeProtocol.HomeMessage)
const CloudJson = Schema.fromJsonString(HomeProtocol.CloudMessage)
const decodeHomeMessage = Schema.decodeUnknownOption(HomeJson)

export const Timing = {
  /** The Cloud pings this often; Quai Home reconnects after 60 s without one. */
  pingMs: 20_000,
  /** This long without any message from Quai Home (its Pongs included), the link is dead. */
  silenceMs: 60_000,
  /** Hello and Proof must each come within this. */
  handshakeMs: 10_000,
  /** A call or a store operation that isn't answered in this time fails. */
  requestMs: 15_000
} as const

/** One live connection from a Quai Home, past its handshake. */
interface Connection {
  services: ReadonlyArray<HomeService>
  readonly protocol: number
  readonly webUrls: HomeProtocol.WebUrls
  readonly send: (message: CloudMessage) => Effect.Effect<void>
  readonly pending: Map<string, Deferred.Deferred<Answer, HomeError>>
  /** Loaded from Quai Home after the Welcome: until then the home isn't ready. */
  documents: Map<string, unknown> | null
  /** Completed to close this connection: another one of the same home replaced it. */
  readonly replaced: Deferred.Deferred<void>
}

/** One home as the links know it: its connection while there is one, its events, its console. */
interface Slot {
  connection: Connection | null
  readonly events: Queue.Queue<HomeEvent>
  consoleHandler: ConsoleHandler | null
}

type HandshakeOutcome =
  | {
    readonly _tag: "Accepted"
    readonly homeId: string
    readonly services: ReadonlyArray<HomeService>
    readonly protocol: number
    readonly webUrls: HomeProtocol.WebUrls
  }
  | { readonly _tag: "Refused"; readonly reason: string; readonly retryAfterSeconds: number }

/** Verifies a Proof: an Ed25519 signature of `challengePayload(nonce)` by the Hello's public key. */
export const verifyProof = (publicKey: string, nonce: string, signature: string): boolean => {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" })
    if (key.asymmetricKeyType !== "ed25519") return false
    return verify(null, Buffer.from(HomeProtocol.challengePayload(nonce)), key, Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}

/**
 * Every Quai Home's WebSocket to `/home`: the handshake, which proves the home's key and names the
 * home, then one `HomeLink` per home. The same home connecting again replaces its old connection.
 */
export class HomeLinks extends Context.Service<HomeLinks, {
  /** Serves one connection from a Quai Home, until it closes. */
  readonly serve: (socket: Socket.Socket) => Effect.Effect<void>
  /** The link to this home, connected or not (yet). */
  readonly link: (homeId: string) => Effect.Effect<HomeLink["Service"]>
  /** The next home whose documents were loaded: on each of its connections. */
  readonly nextReady: Effect.Effect<string>
  /** Forgets a home that isn't connected, with its events: false, and nothing changes, if it is. */
  readonly forget: (homeId: string) => Effect.Effect<boolean>
}>()("quai/HomeLinks") {
  /**
   * `QUAI_HOME_ID`, when set, lists the only homes served (comma-separated): any other is refused at
   * the handshake. Quai Home logs its id (`linked as home …`). `QUAI_MAX_HOMES` caps how many are
   * connected at once.
   */
  static readonly make = Effect.gen(function*() {
    const only = yield* Config.option(Config.String("QUAI_HOME_ID")).pipe(Effect.orDie)
    const expectedHomeIds = Option.map(
      only,
      (ids) => ids.split(",").map((id) => id.trim().toLowerCase()).filter((id) => id !== "")
    )
    if (
      Option.isSome(expectedHomeIds) &&
      (expectedHomeIds.value.length === 0 || expectedHomeIds.value.some((id) => !/^[0-9a-f]{32}$/.test(id)))
    ) {
      return yield* Effect.die(new Error("QUAI_HOME_ID: a home id is 32 hex characters, as Quai Home logs it"))
    }
    const maxHomes = yield* Config.option(Config.Int("QUAI_MAX_HOMES")).pipe(Effect.orDie)
    if (Option.isSome(maxHomes) && maxHomes.value < 1) return yield* Effect.die(new Error("QUAI_MAX_HOMES: at least 1"))

    const slots = new Map<string, Slot>()
    const readyHomes = yield* Queue.unbounded<string>()
    const requestCount = yield* Ref.make(0)

    const slotOf = (homeId: string): Effect.Effect<Slot> =>
      Effect.suspend(() => {
        const existing = slots.get(homeId)
        if (existing !== undefined) return Effect.succeed(existing)
        return Effect.map(Queue.unbounded<HomeEvent>(), (events) => {
          const created: Slot = { connection: null, events, consoleHandler: null }
          slots.set(homeId, created)
          return created
        })
      })
    const connectedCount = (except: string) =>
      [...slots].filter(([id, slot]) => id !== except && slot.connection !== null).length

    /** A relayed console request: only the console's paths, and only once something answers them. */
    const answerConsole = (slot: Slot, request: ConsoleRequest) =>
      Effect.gen(function*() {
        if (!HomeProtocol.isConsolePath(request.path)) return { status: 404, body: "" }
        const handler = slot.consoleHandler
        if (handler === null) {
          return { status: 503, body: JSON.stringify({ _tag: "HomeOffline", message: "Quai Cloud is starting" }) }
        }
        return yield* handler(request)
      })

    const request = (
      connection: Connection,
      make: (id: string) => CloudMessage,
      timeoutMs: number = Timing.requestMs
    ) =>
      Effect.gen(function*() {
        const id = `r${yield* Ref.updateAndGet(requestCount, (count) => count + 1)}`
        const answer = yield* Deferred.make<Answer, HomeError>()
        connection.pending.set(id, answer)
        yield* connection.send(make(id))
        return yield* Deferred.await(answer).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new HomeError({ reason: "timeout", message: "Quai Home didn't answer in time" }))
          }),
          Effect.ensuring(Effect.sync(() => connection.pending.delete(id)))
        )
      })

    const failedWith = (answer: Answer) =>
      answer._tag === "Failed"
        ? Effect.fail(new HomeError({ reason: "failed", message: answer.reason }))
        : Effect.succeed(answer)

    const linkOf = (homeId: string): Effect.Effect<HomeLink["Service"]> =>
      Effect.map(slotOf(homeId), (slot): HomeLink["Service"] => {
        const ready = () => slot.connection !== null && slot.connection.documents !== null ? slot.connection : null
        const current = Effect.suspend(() => {
          const connection = ready()
          return connection === null
            ? Effect.fail(new HomeError({ reason: "offline", message: offlineMessage }))
            : Effect.succeed(connection)
        })
        const documents = makeDocuments(
          Effect.map(current, (connection) => connection.documents!),
          (key, value) =>
            Effect.gen(function*() {
              const connection = yield* current
              const answer = yield* request(connection, (id) =>
                value === undefined
                  ? HomeProtocol.StoreDelete.make({ id, key })
                  : HomeProtocol.StorePut.make({ id, key, value })).pipe(Effect.flatMap(failedWith))
              if (answer._tag !== "StoreDone") {
                return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
              }
              if (value === undefined) connection.documents?.delete(key)
              else connection.documents?.set(key, value)
            })
        )
        return {
          homeId,
          home: Effect.sync(() => {
            const connection = ready()
            return connection === null
              ? Option.none()
              : Option.some({
                homeId,
                services: connection.services,
                protocol: connection.protocol,
                webUrls: connection.webUrls
              })
          }),
          call: (call, options) =>
            Effect.gen(function*() {
              const connection = yield* current
              const answer = yield* request(connection, (id) =>
                HomeProtocol.Call.make({ ...call, id }), options?.timeoutMs).pipe(Effect.flatMap(failedWith))
              if (answer._tag !== "CallResponse") {
                return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
              }
              return { status: answer.status, body: answer.body }
            }),
          setWatches: (watches) =>
            Effect.flatMap(current, (connection) => connection.send(HomeProtocol.SetWatches.make({ watches }))),
          appendJournal: (entries) =>
            Effect.flatMap(current, (connection) =>
              connection.protocol < HomeProtocol.journalProtocolVersion
                ? Effect.fail(new HomeError({ reason: "failed", message: "this Quai Home keeps no journal" }))
                : connection.send(HomeProtocol.JournalAppend.make({ entries }))),
          readJournal: (query) =>
            Effect.gen(function*() {
              const connection = yield* current
              if (connection.protocol < HomeProtocol.journalProtocolVersion) {
                return yield* Effect.fail(
                  new HomeError({ reason: "failed", message: "this Quai Home keeps no journal" })
                )
              }
              const answer = yield* request(connection, (id) => HomeProtocol.JournalRead.make({ id, query })).pipe(
                Effect.flatMap(failedWith)
              )
              if (answer._tag !== "JournalPage") {
                return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
              }
              return { entries: answer.entries, more: answer.more }
            }),
          documents: { homeId, ...documents },
          nextEvent: Queue.take(slot.events),
          answerConsole: (handler) => Effect.sync(() => (slot.consoleHandler = handler))
        }
      })

    const serve = (socket: Socket.Socket) =>
      Effect.gen(function*() {
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        const send = (message: CloudMessage) =>
          Schema.encodeEffect(CloudJson)(message).pipe(
            Effect.flatMap(writer.write),
            Effect.catch((error) => Effect.logDebug(`could not send ${message._tag}`, error))
          )
        const close = (code: number, reason: string) => Effect.ignore(writer.write(new Socket.CloseEvent(code, reason)))

        const frames: Array<string> = []
        const lastHeard = yield* Ref.make(yield* Clock.currentTimeMillis)
        const next: Effect.Effect<Option.Option<HomeMessage>, Socket.SocketError> = Effect.gen(function*() {
          if (frames.length === 0) frames.push(...(yield* pull))
          yield* Ref.set(lastHeard, yield* Clock.currentTimeMillis)
          return decodeHomeMessage(frames.shift()!)
        })
        const expect = <T extends HomeMessage["_tag"]>(tag: T) =>
          Effect.gen(function*() {
            const message = yield* next
            return Option.isSome(message) && message.value._tag === tag
              ? Option.some(message.value as Extract<HomeMessage, { readonly _tag: T }>)
              : Option.none()
          }).pipe(Effect.timeoutOption(Timing.handshakeMs), Effect.map(Option.flatten))

        const handshake = Effect.gen(function*(): Effect.fn.Return<HandshakeOutcome, Socket.SocketError> {
          const hello = yield* expect("Hello")
          if (Option.isNone(hello)) return { _tag: "Refused", reason: "expected a Hello", retryAfterSeconds: 60 }
          const protocol = hello.value.protocol
          if (protocol < HomeProtocol.minProtocolVersion || protocol > HomeProtocol.protocolVersion) {
            return {
              _tag: "Refused",
              reason:
                `this Cloud speaks protocols ${HomeProtocol.minProtocolVersion} to ${HomeProtocol.protocolVersion}, this Quai Home ${protocol}`,
              retryAfterSeconds: 3600
            }
          }
          const nonce = randomBytes(32).toString("base64")
          yield* send(HomeProtocol.Challenge.make({ nonce }))
          const proof = yield* expect("Proof")
          if (Option.isNone(proof) || !verifyProof(hello.value.publicKey, nonce, proof.value.signature)) {
            return { _tag: "Refused", reason: "the proof doesn't match the public key", retryAfterSeconds: 60 }
          }
          const homeId = HomeId.homeId(hello.value.publicKey)
          if (Option.isSome(expectedHomeIds) && !expectedHomeIds.value.includes(homeId)) {
            return {
              _tag: "Refused",
              reason: `this Cloud serves ${expectedHomeIds.value.join(", ")} only (QUAI_HOME_ID), not ${homeId}`,
              retryAfterSeconds: 3600
            }
          }
          if (Option.isSome(maxHomes) && connectedCount(homeId) >= maxHomes.value) {
            return {
              _tag: "Refused",
              reason: `this Cloud serves ${maxHomes.value} home${maxHomes.value === 1 ? "" : "s"} at most`,
              retryAfterSeconds: 300
            }
          }
          return {
            _tag: "Accepted",
            homeId,
            services: hello.value.services,
            protocol,
            webUrls: hello.value.webUrls ?? {}
          }
        })

        const outcome = yield* handshake
        if (outcome._tag === "Refused") {
          yield* Effect.logInfo(`refused a Quai Home: ${outcome.reason}`)
          yield* send(
            HomeProtocol.Refused.make({ reason: outcome.reason, retryAfterSeconds: outcome.retryAfterSeconds })
          )
          return yield* close(1008, outcome.reason)
        }

        const { homeId } = outcome
        const slot = yield* slotOf(homeId)
        const events = slot.events
        const connection: Connection = {
          services: outcome.services,
          protocol: outcome.protocol,
          webUrls: outcome.webUrls,
          send,
          pending: new Map(),
          documents: null,
          replaced: yield* Deferred.make<void>()
        }
        const previous = slot.connection
        if (previous !== null) yield* Deferred.succeed(previous.replaced, undefined)
        slot.connection = connection
        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            const wasReady = connection.documents !== null
            if (slot.connection === connection) slot.connection = null
            connection.documents = null
            for (const answer of connection.pending.values()) {
              yield* Deferred.fail(answer, new HomeError({ reason: "offline", message: offlineMessage }))
            }
            if (wasReady && slot.connection === null) yield* Queue.offer(events, { _tag: "Gone", homeId })
            yield* Effect.logInfo(`home ${homeId} disconnected`)
          })
        )

        yield* send(HomeProtocol.Welcome.make({ homeId }))
        yield* Effect.logInfo(`home ${homeId} connected`)

        // What Quai Home sends on its own waits for its documents, so nothing reads a home half loaded.
        const inbox = yield* Queue.unbounded<HomeEvent>()
        yield* Effect.forkScoped(
          Effect.gen(function*() {
            const answer = yield* request(connection, (id) => HomeProtocol.StoreList.make({ id, prefix: "" })).pipe(
              Effect.flatMap(failedWith)
            )
            if (answer._tag !== "StoreDocuments") {
              return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
            }
            connection.documents = new Map(answer.documents.map((document) => [document.key, document.value]))
            yield* Queue.offer(events, {
              _tag: "Ready",
              home: {
                homeId,
                services: connection.services,
                protocol: connection.protocol,
                webUrls: connection.webUrls
              }
            })
            yield* Queue.offer(readyHomes, homeId)
            yield* Effect.forever(Effect.flatMap(Queue.take(inbox), (event) => Queue.offer(events, event)))
          }).pipe(
            Effect.catchTag("HomeError", (error) =>
              Effect.andThen(
                Effect.logWarning(`could not load home ${homeId}: ${error.message}`),
                Deferred.succeed(connection.replaced, undefined)
              ))
          )
        )

        const read = Effect.forever(Effect.gen(function*() {
          const decoded = yield* next
          if (Option.isNone(decoded)) {
            return yield* Effect.logWarning("ignored a message from Quai Home that isn't part of the protocol")
          }
          const message = decoded.value
          switch (message._tag) {
            case "CallResponse":
            case "StoreDocuments":
            case "StoreDone":
            case "JournalPage":
            case "Failed": {
              const answer = connection.pending.get(message.id)
              if (answer !== undefined) {
                connection.pending.delete(message.id)
                return yield* Deferred.succeed(answer, message)
              }
              // Not a request of ours: one of the watches failed.
              if (message._tag === "Failed") {
                yield* Queue.offer(inbox, { _tag: "WatchFailed", watchId: message.id, reason: message.reason })
              }
              return
            }
            case "WatchSnapshot":
              return yield* Queue.offer(inbox, {
                _tag: "Snapshot",
                watchId: message.watchId,
                status: message.status,
                body: message.body
              })
            case "WebhookReceived":
              return yield* Queue.offer(inbox, {
                _tag: "Webhook",
                service: message.service,
                receivedAt: message.receivedAt,
                body: message.body
              })
            case "JournalNoted":
              return yield* Queue.offer(inbox, { _tag: "Journal", entries: message.entries })
            case "ConsoleRequest": {
              const { id, _tag, ...request } = message
              return yield* Effect.forkScoped(Effect.flatMap(answerConsole(slot, request), (answer) =>
                send(HomeProtocol.ConsoleResponse.make({ id, status: answer.status, body: answer.body }))))
            }
            case "ServicesChanged":
              connection.services = message.services
              return yield* Queue.offer(inbox, {
                _tag: "Services",
                home: {
                  homeId,
                  services: connection.services,
                  protocol: connection.protocol,
                  webUrls: connection.webUrls
                }
              })
            case "Pong":
            case "Hello":
            case "Proof":
              return
          }
        }))

        const ping = Effect.forever(Effect.andThen(
          Effect.sleep(Timing.pingMs),
          Effect.flatMap(Clock.currentTimeMillis, (at) =>
            send(HomeProtocol.Ping.make({ at })))
        ))

        const silence = Effect.gen(function*() {
          while (true) {
            const quietFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastHeard))
            if (quietFor >= Timing.silenceMs) {
              return yield* Effect.logInfo(`home ${homeId} silent for ${Timing.silenceMs / 1000} s`)
            }
            yield* Effect.sleep(Timing.silenceMs - quietFor)
          }
        })

        yield* Effect.forkScoped(ping)
        yield* Effect.raceAllFirst([read, silence, Deferred.await(connection.replaced)])
        yield* close(1000, "closing")
      }).pipe(
        Effect.scoped,
        Effect.catchTag("SocketError", () => Effect.void)
      )

    return {
      serve,
      link: linkOf,
      nextReady: Queue.take(readyHomes),
      forget: (homeId) =>
        Effect.sync(() => {
          const slot = slots.get(homeId)
          if (slot === undefined) return true
          if (slot.connection !== null) return false
          slots.delete(homeId)
          return true
        })
    } satisfies HomeLinks["Service"]
  })

  static readonly layer = Layer.effect(HomeLinks, HomeLinks.make)

  /** One home's link, on links of their own: for tests and the preview, which serve that home only. */
  static readonly linkOf = (homeId: string) =>
    Layer.effect(HomeLink, Effect.flatMap(Effect.service(HomeLinks), (links) => links.link(homeId))).pipe(
      Layer.provideMerge(HomeLinks.layer)
    )
}

/** `GET /home`: Quai Home's WebSocket. */
export const HomeRoute = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const links = yield* HomeLinks
    yield* router.add(
      "GET",
      "/home",
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const socket = yield* request.upgrade
        yield* links.serve(socket)
        return HttpServerResponse.empty()
      }).pipe(
        Effect.catchTag("HttpServerError", () =>
          Effect.succeed(HttpServerResponse.text("Quai Home connects here with a WebSocket.", { status: 426 })))
      )
    )
  })
)
