import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { pairingHash } from "@quai/domain/home/Devices.ts"
import { HomeError, offlineMessage } from "@quai/domain/home/HomeLink.ts"
import { PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Clock, Config, Context, Deferred, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { createPublicKey, randomBytes, verify } from "node:crypto"

type HomeMessage = HomeProtocol.HomeMessage
type CloudMessage = HomeProtocol.CloudMessage

const CloudJson = Schema.fromJsonString(HomeProtocol.CloudMessage)
const decodeHomeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HomeProtocol.HomeMessage))

export const Timing = {
  /** The Cloud pings this often; Quai Home reconnects after 60 s without one. */
  pingMs: 20_000,
  /** This long without any message from Quai Home (its Pongs included), the link is dead. */
  silenceMs: 60_000,
  /** Hello and Proof must each come within this. */
  handshakeMs: 10_000,
  /** A home may ask for `pushLimit` pushes in this time; past it they are refused until it has passed. */
  pushWindowMs: 60_000
} as const

/** Pushes one home may ask for in `Timing.pushWindowMs`: a few iPhones following a few downloads stay far under it. */
export const pushLimit = 300

/** One of the app's requests, as relayed to its home, and what the home answered. */
export type AppRelayRequest = Omit<HomeProtocol.AppRequest, "_tag" | "id">
export interface AppRelayResponse {
  readonly status: number
  readonly contentType?: string
  readonly body: string
}
/** Relays one request to a home. */
export type AppRelay = (request: AppRelayRequest) => Effect.Effect<AppRelayResponse, HomeError>

/** One live connection from a Quai Home, past its handshake. */
interface Connection {
  readonly send: (message: CloudMessage) => Effect.Effect<void>
  /** The app's requests relayed on this connection, waiting for the home's answer. */
  readonly relayed: Map<string, Deferred.Deferred<HomeProtocol.AppResponse, HomeError>>
  /** When each push of the last `Timing.pushWindowMs` was asked for. */
  pushedAt: Array<number>
  /** The hashes of the pairing codes the home said are open. */
  pairingHashes: ReadonlySet<string>
  /** Completed to close this connection: another one of the same home replaced it. */
  readonly replaced: Deferred.Deferred<void>
}

type HandshakeOutcome =
  | { readonly _tag: "Accepted"; readonly homeId: string }
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
 * home, then the relay of the app's requests to it and the pushes it asks for. The same home
 * connecting again replaces its old connection.
 */
export class HomeLinks extends Context.Service<HomeLinks, {
  /** Serves one connection from a Quai Home, until it closes. */
  readonly serve: (socket: Socket.Socket) => Effect.Effect<void>
  /** How to relay the app's requests to this home: None while it isn't connected. */
  readonly relayOf: (homeId: string) => Effect.Effect<Option.Option<AppRelay>>
  /** The connected home that said this pairing code is one of its open ones. */
  readonly pairingHome: (code: string) => Effect.Effect<Option.Option<string>>
  /** The connected homes. */
  readonly homeIds: Effect.Effect<ReadonlyArray<string>>
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

    // What a home is told and given: the push key's settings and its pushes, the public access.
    const apns = yield* Apns
    const publicAccess = yield* PublicAccess
    const info = yield* ServerInfo
    const welcomeOf = (homeId: string) =>
      HomeProtocol.Welcome.make({
        homeId,
        version: info.version,
        push: apns.settings,
        publicAccess: {
          ...Option.match(publicAccess.url, { onNone: () => ({}), onSome: (url) => ({ url }) }),
          headers: publicAccess.headers.map((header) => ({
            name: header.name,
            value: Redacted.value(header.value)
          }))
        }
      })

    /** The connection of each home connected now. */
    const connections = new Map<string, Connection>()
    const requestCount = yield* Ref.make(0)
    const connectedCount = (except: string) => [...connections.keys()].filter((id) => id !== except).length

    /** Relays one of the app's requests on this connection, and waits for the home's answer. */
    const relay = (connection: Connection): AppRelay => (appRequest) =>
      Effect.gen(function*() {
        const id = `a${yield* Ref.updateAndGet(requestCount, (count) => count + 1)}`
        const answer = yield* Deferred.make<HomeProtocol.AppResponse, HomeError>()
        connection.relayed.set(id, answer)
        yield* connection.send(HomeProtocol.AppRequest.make({ ...appRequest, id }))
        const response = yield* Deferred.await(answer).pipe(
          Effect.timeoutOrElse({
            duration: HomeProtocol.appRequestTimeoutSeconds * 1000,
            orElse: () => Effect.fail(new HomeError({ reason: "timeout", message: "Quai Home didn't answer in time" }))
          }),
          Effect.ensuring(Effect.sync(() => connection.relayed.delete(id)))
        )
        return {
          status: response.status,
          body: response.body,
          ...(response.contentType === undefined ? {} : { contentType: response.contentType })
        }
      })

    /** Whether this home may ask for one more push now: at most `pushLimit` in `Timing.pushWindowMs`. */
    const mayPush = (connection: Connection, now: number) => {
      connection.pushedAt = connection.pushedAt.filter((at) => now - at < Timing.pushWindowMs)
      if (connection.pushedAt.length >= pushLimit) return false
      connection.pushedAt.push(now)
      return true
    }

    /** Sends the push a home asked for with the Cloud's key, and tells it what APNs answered. */
    const push = (connection: Connection, message: HomeProtocol.PushRequest) =>
      Effect.gen(function*() {
        const refused = (reason: string) =>
          HomeProtocol.PushResponse.make({ id: message.id, error: { status: null, reason, tokenGone: false } })
        if (!(yield* apns.configured)) return refused("this Quai Cloud has no APNs key")
        if (!mayPush(connection, yield* Clock.currentTimeMillis)) {
          return refused("too many pushes: try again in a minute")
        }
        const { _tag, id, ...request } = message
        return yield* apns.send(request).pipe(
          Effect.as(HomeProtocol.PushResponse.make({ id })),
          Effect.catchTag("ApnsError", (error) =>
            Effect.succeed(
              HomeProtocol.PushResponse.make({
                id,
                error: { status: error.status, reason: error.reason, tokenGone: error.tokenGone }
              })
            ))
        )
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
          return { _tag: "Accepted", homeId }
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
        const connection: Connection = {
          send,
          relayed: new Map(),
          pushedAt: [],
          pairingHashes: new Set(),
          replaced: yield* Deferred.make<void>()
        }
        const previous = connections.get(homeId)
        if (previous !== undefined) yield* Deferred.succeed(previous.replaced, undefined)
        connections.set(homeId, connection)
        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            if (connections.get(homeId) === connection) connections.delete(homeId)
            const offline = new HomeError({ reason: "offline", message: offlineMessage })
            for (const answer of connection.relayed.values()) yield* Deferred.fail(answer, offline)
            yield* Effect.logInfo(`home ${homeId} disconnected`)
          })
        )

        yield* send(welcomeOf(homeId))
        yield* Effect.logInfo(`home ${homeId} connected`)

        const read = Effect.forever(Effect.gen(function*() {
          const decoded = yield* next
          // What an older Quai Home still sends (`ServicesChanged`) lands here too: nothing reads it.
          if (Option.isNone(decoded)) {
            return yield* Effect.logDebug("ignored a message from Quai Home that isn't part of the protocol")
          }
          const message = decoded.value
          switch (message._tag) {
            case "AppResponse": {
              const answer = connection.relayed.get(message.id)
              if (answer === undefined) return
              connection.relayed.delete(message.id)
              return yield* Deferred.succeed(answer, message)
            }
            case "PushRequest":
              return yield* Effect.forkScoped(Effect.flatMap(push(connection, message), send))
            case "PairingCodes":
              connection.pairingHashes = new Set(message.hashes.slice(0, HomeProtocol.maxPairingCodes))
              return
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
      relayOf: (homeId) =>
        Effect.sync(() => {
          const connection = connections.get(homeId)
          return connection === undefined ? Option.none() : Option.some(relay(connection))
        }),
      pairingHome: (code) =>
        Effect.sync(() => {
          const hash = pairingHash(code)
          const holder = [...connections].find(([, connection]) => connection.pairingHashes.has(hash))
          return Option.fromNullishOr(holder?.[0])
        }),
      homeIds: Effect.sync(() => [...connections.keys()])
    } satisfies HomeLinks["Service"]
  })

  static readonly layer = Layer.effect(HomeLinks, HomeLinks.make)
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
