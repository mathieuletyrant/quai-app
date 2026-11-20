import { HomeOffline, HomeProtocol, HomeRequired } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { Clock, Config, Context, Data, Deferred, Effect, Layer, Option, Queue, Ref, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { createPublicKey, randomBytes, verify } from "node:crypto"

type HomeMessage = HomeProtocol.HomeMessage
type CloudMessage = HomeProtocol.CloudMessage
type HomeService = HomeProtocol.HomeService
type Answer = Extract<HomeMessage, { readonly _tag: "CallResponse" | "Failed" | "StoreDocuments" | "StoreDone" }>

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

/** The home Quai Cloud serves, once its documents are loaded. */
export interface LinkedHome {
  readonly homeId: string
  /** The services this Quai Home reaches (from its Hello). */
  readonly services: ReadonlyArray<HomeService>
}

/** What Quai Home tells, in the order it told it. */
export type HomeEvent =
  | { readonly _tag: "Ready"; readonly home: LinkedHome }
  | { readonly _tag: "Gone"; readonly homeId: string }
  | { readonly _tag: "Snapshot"; readonly watchId: string; readonly status: number; readonly body: string }
  | { readonly _tag: "WatchFailed"; readonly watchId: string; readonly reason: string }
  | { readonly _tag: "Webhook"; readonly service: HomeService; readonly receivedAt: number; readonly body: unknown }

export interface HomeDocument {
  readonly key: string
  readonly value: unknown
}

export type CallRequest = Omit<HomeProtocol.Call, "_tag" | "id">

/**
 * The home's documents (paired iPhones, flows, activities), as Quai Home keeps them. Quai Cloud
 * holds them in memory while the home is connected and writes every change back: a write returns
 * once Quai Home said it is on disk.
 */
export class HomeDocuments extends Context.Service<HomeDocuments, {
  readonly get: (key: string) => Effect.Effect<Option.Option<unknown>, HomeError>
  /** Every document whose key starts with `prefix`, sorted by key. */
  readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<HomeDocument>, HomeError>
  readonly put: (key: string, value: unknown) => Effect.Effect<void, HomeError>
  readonly delete: (key: string) => Effect.Effect<void, HomeError>
}>()("quai/HomeDocuments") {
  /** Always connected, kept in memory: for tests of what sits on top. */
  static readonly memory = Layer.sync(HomeDocuments, () => {
    const documents = new Map<string, unknown>()
    return makeDocuments(Effect.succeed(documents), (key, value) =>
      Effect.sync(() => {
        if (value === undefined) documents.delete(key)
        else documents.set(key, value)
      }))
  })
}

/** A copy as it would come back from disk: what is cached is what a restarted Cloud would read. */
const asStored = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null")

const makeDocuments = (
  documents: Effect.Effect<Map<string, unknown>, HomeError>,
  write: (key: string, value: unknown | undefined) => Effect.Effect<void, HomeError>
): HomeDocuments["Service"] => {
  const checked = (key: string) =>
    HomeProtocol.isStoreKey(key) ? Effect.void : Effect.die(new Error(`invalid home document key: ${key}`))
  return {
    get: (key) => Effect.map(documents, (all) => Option.fromNullishOr(all.get(key))),
    list: (prefix) =>
      Effect.map(documents, (all) =>
        [...all].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([key, value]) => ({ key, value }))),
    put: (key, value) => Effect.andThen(checked(key), write(key, asStored(value))),
    delete: (key) => Effect.andThen(checked(key), write(key, undefined))
  }
}

/** One live connection from a Quai Home, past its handshake. */
interface Connection {
  readonly homeId: string
  readonly services: ReadonlyArray<HomeService>
  readonly send: (message: CloudMessage) => Effect.Effect<void>
  readonly pending: Map<string, Deferred.Deferred<Answer, HomeError>>
  /** Loaded from Quai Home after the Welcome: until then the home isn't ready. */
  documents: Map<string, unknown> | null
  /** Completed to close this connection: another one of the same home replaced it. */
  readonly replaced: Deferred.Deferred<void>
}

type HandshakeOutcome =
  | { readonly _tag: "Accepted"; readonly homeId: string; readonly services: ReadonlyArray<HomeService> }
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
 * The link to Quai Home: the WebSocket it opens to `/home`, its handshake, the calls and store
 * operations Quai Cloud sends it, and what it sends on its own (snapshots, webhooks), as events.
 *
 * One home for now: while one is connected, another home is refused; the same home connecting
 * again replaces its old connection. Connections are kept by home id, ready for several homes.
 */
export class HomeLink extends Context.Service<HomeLink, {
  /** The connected home, once its documents are loaded. */
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
  readonly documents: HomeDocuments["Service"]
  /** The next event from Quai Home. One reader: the Hub. */
  readonly nextEvent: Effect.Effect<HomeEvent>
  /** Serves one connection from Quai Home, until it closes. */
  readonly serve: (socket: Socket.Socket) => Effect.Effect<void>
}>()("quai/HomeLink") {
  /**
   * `QUAI_HOME_ID`, when set, is the only home served: any other is refused at the handshake, so a
   * foreign Quai Home can't take the slot while the real one is away. Quai Home logs its id
   * (`linked as home …`).
   */
  static readonly make = Effect.gen(function*() {
    const only = yield* Config.option(Config.String("QUAI_HOME_ID")).pipe(Effect.orDie)
    const expectedHomeId = Option.map(only, (id) => id.trim().toLowerCase())
    if (Option.isSome(expectedHomeId) && !/^[0-9a-f]{32}$/.test(expectedHomeId.value)) {
      return yield* Effect.die(new Error("QUAI_HOME_ID: a home id is 32 hex characters, as Quai Home logs it"))
    }
    const connections = new Map<string, Connection>()
    const events = yield* Queue.unbounded<HomeEvent>()
    const requestCount = yield* Ref.make(0)

    const ready = (): Connection | null => {
      for (const connection of connections.values()) if (connection.documents !== null) return connection
      return null
    }
    const current = Effect.suspend(() => {
      const connection = ready()
      return connection === null
        ? Effect.fail(new HomeError({ reason: "offline", message: offlineMessage }))
        : Effect.succeed(connection)
    })

    const request = (connection: Connection, make: (id: string) => CloudMessage, timeoutMs: number = Timing.requestMs) =>
      Effect.gen(function*() {
        const id = `r${yield* Ref.updateAndGet(requestCount, (n) => n + 1)}`
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
      answer._tag === "Failed" ? Effect.fail(new HomeError({ reason: "failed", message: answer.reason })) : Effect.succeed(answer)

    const documents = makeDocuments(
      Effect.map(current, (c) => c.documents!),
      (key, value) =>
        Effect.gen(function*() {
          const connection = yield* current
          const answer = yield* request(connection, (id) =>
            value === undefined
              ? HomeProtocol.StoreDelete.make({ id, key })
              : HomeProtocol.StorePut.make({ id, key, value })).pipe(Effect.flatMap(failedWith))
          if (answer._tag !== "StoreDone") return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
          if (value === undefined) connection.documents?.delete(key)
          else connection.documents?.set(key, value)
        })
    )

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
              reason: `this Cloud speaks protocols ${HomeProtocol.minProtocolVersion} to ${HomeProtocol.protocolVersion}, this Quai Home ${protocol}`,
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
          if (Option.isSome(expectedHomeId) && homeId !== expectedHomeId.value) {
            return { _tag: "Refused", reason: `this Cloud serves home ${expectedHomeId.value} only (QUAI_HOME_ID), not ${homeId}`, retryAfterSeconds: 3600 }
          }
          for (const other of connections.values()) {
            if (other.homeId !== homeId) return { _tag: "Refused", reason: "this Cloud serves one home", retryAfterSeconds: 300 }
          }
          return { _tag: "Accepted", homeId, services: hello.value.services }
        })

        const outcome = yield* handshake
        if (outcome._tag === "Refused") {
          yield* Effect.logInfo(`refused a Quai Home: ${outcome.reason}`)
          yield* send(HomeProtocol.Refused.make({ reason: outcome.reason, retryAfterSeconds: outcome.retryAfterSeconds }))
          return yield* close(1008, outcome.reason)
        }

        const { homeId } = outcome
        const connection: Connection = {
          homeId,
          services: outcome.services,
          send,
          pending: new Map(),
          documents: null,
          replaced: yield* Deferred.make<void>()
        }
        const previous = connections.get(homeId)
        if (previous !== undefined) yield* Deferred.succeed(previous.replaced, undefined)
        connections.set(homeId, connection)
        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            const wasReady = connection.documents !== null
            if (connections.get(homeId) === connection) connections.delete(homeId)
            connection.documents = null
            for (const answer of connection.pending.values()) {
              yield* Deferred.fail(answer, new HomeError({ reason: "offline", message: offlineMessage }))
            }
            if (wasReady && !connections.has(homeId)) yield* Queue.offer(events, { _tag: "Gone", homeId })
            yield* Effect.logInfo(`home ${homeId} disconnected`)
          }))

        yield* send(HomeProtocol.Welcome.make({ homeId }))
        yield* Effect.logInfo(`home ${homeId} connected`)

        // What Quai Home sends on its own waits for its documents, so nothing reads a home half loaded.
        const inbox = yield* Queue.unbounded<HomeEvent>()
        const loaded = yield* Deferred.make<void>()
        yield* Effect.forkScoped(Effect.gen(function*() {
          const answer = yield* request(connection, (id) => HomeProtocol.StoreList.make({ id, prefix: "" })).pipe(Effect.flatMap(failedWith))
          if (answer._tag !== "StoreDocuments") return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
          connection.documents = new Map(answer.documents.map((d) => [d.key, d.value]))
          yield* Queue.offer(events, { _tag: "Ready", home: { homeId, services: connection.services } })
          yield* Deferred.succeed(loaded, undefined)
          yield* Effect.forever(Effect.flatMap(Queue.take(inbox), (event) => Queue.offer(events, event)))
        }).pipe(
          Effect.catchTag("HomeError", (error) =>
            Effect.andThen(
              Effect.logWarning(`could not load home ${homeId}: ${error.message}`),
              Deferred.succeed(connection.replaced, undefined)
            ))
        ))

        const read = Effect.forever(Effect.gen(function*() {
          const decoded = yield* next
          if (Option.isNone(decoded)) return yield* Effect.logWarning("ignored a message from Quai Home that isn't part of the protocol")
          const message = decoded.value
          switch (message._tag) {
            case "CallResponse":
            case "StoreDocuments":
            case "StoreDone":
            case "Failed": {
              const answer = connection.pending.get(message.id)
              if (answer !== undefined) {
                connection.pending.delete(message.id)
                return yield* Deferred.succeed(answer, message)
              }
              // Not a request of ours: one of the watches failed.
              if (message._tag === "Failed") yield* Queue.offer(inbox, { _tag: "WatchFailed", watchId: message.id, reason: message.reason })
              return
            }
            case "WatchSnapshot":
              return yield* Queue.offer(inbox, { _tag: "Snapshot", watchId: message.watchId, status: message.status, body: message.body })
            case "WebhookReceived":
              return yield* Queue.offer(inbox, { _tag: "Webhook", service: message.service, receivedAt: message.receivedAt, body: message.body })
            case "Pong":
            case "Hello":
            case "Proof":
              return
          }
        }))

        const ping = Effect.forever(Effect.andThen(
          Effect.sleep(Timing.pingMs),
          Effect.flatMap(Clock.currentTimeMillis, (at) => send(HomeProtocol.Ping.make({ at })))
        ))

        const silence = Effect.gen(function*() {
          while (true) {
            const quietFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastHeard))
            if (quietFor >= Timing.silenceMs) return yield* Effect.logInfo(`home ${homeId} silent for ${Timing.silenceMs / 1000} s`)
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
      home: Effect.sync(() => {
        const connection = ready()
        return connection === null ? Option.none() : Option.some({ homeId: connection.homeId, services: connection.services })
      }),
      call: (call, options) =>
        Effect.gen(function*() {
          const connection = yield* current
          const answer = yield* request(connection, (id) => HomeProtocol.Call.make({ ...call, id }), options?.timeoutMs).pipe(Effect.flatMap(failedWith))
          if (answer._tag !== "CallResponse") return yield* Effect.fail(new HomeError({ reason: "failed", message: `unexpected ${answer._tag}` }))
          return { status: answer.status, body: answer.body }
        }),
      setWatches: (watches) => Effect.flatMap(current, (connection) => connection.send(HomeProtocol.SetWatches.make({ watches }))),
      documents,
      nextEvent: Queue.take(events),
      serve
    } satisfies HomeLink["Service"]
  })

  static readonly layer = Layer.effect(HomeLink, HomeLink.make)

  /** The connected home's documents. */
  static readonly documents = Layer.effect(HomeDocuments, Effect.map(Effect.service(HomeLink), (link) => link.documents))
}

/** `GET /home`: Quai Home's WebSocket. */
export const HomeRoute = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const link = yield* HomeLink
    yield* router.add("GET", "/home", Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const socket = yield* request.upgrade
      yield* link.serve(socket)
      return HttpServerResponse.empty()
    }).pipe(Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.text("Quai Home connects here with a WebSocket.", { status: 426 })))))
  })
)

/** The API's routes that need the home: 503 while it isn't connected. */
export const HomeRequiredLive = Layer.effect(
  HomeRequired,
  Effect.gen(function*() {
    const link = yield* HomeLink
    const connected = Effect.flatMap(link.home, (home) =>
      Option.isSome(home) ? Effect.void : Effect.fail(new HomeOffline({ message: offlineMessage })))
    return (httpEffect) => Effect.andThen(connected, httpEffect)
  })
)
