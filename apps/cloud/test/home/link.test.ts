import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { ConfigProvider, Effect, Layer, Option, Queue, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { HomeLinks, HomeRoute } from "../../src/home/HomeLinks.ts"
import { makeApns } from "../../src/push/ApnsClient.ts"
import { settle } from "../fakeHome.ts"
import { makeLinkedHome, otherHomeKey } from "./linkedHome.ts"

/** The links alone, with no APNs key and no public address to tell. */
const Links = HomeLinks.layer.pipe(Layer.provide(Layer.mergeAll(
  Layer.succeed(ServerInfo, { version: "test", startedAt: 0 }),
  Layer.effect(Apns, makeApns(null)),
  Layer.succeed(PublicAccess, PublicAccess.make(Option.none(), []))
)))

const homeIds = Effect.flatMap(Effect.service(HomeLinks), (links) => links.homeIds)

describe("home link", () => {
  it.effect("a good proof is welcomed under the key's home id", () =>
    Effect.gen(function*() {
      const home = yield* makeLinkedHome()
      yield* home.connect
      expect(home.state.welcomed).toBe(home.homeId)
      expect(yield* homeIds).toEqual([home.homeId])
      expect(Option.isSome(yield* (yield* HomeLinks).relayOf(home.homeId))).toBe(true)
    }).pipe(Effect.provide(Links)))

  it.effect("a bad proof and a protocol out of range are refused; a second home links on its own", () =>
    Effect.gen(function*() {
      const forger = yield* makeLinkedHome({ badProof: true })
      yield* forger.open
      expect(forger.state.refused).toEqual({ reason: "the proof doesn't match the public key", retryAfterSeconds: 60 })
      expect(forger.state.closed).toBe(true)

      for (const protocol of [HomeProtocol.minProtocolVersion - 1, HomeProtocol.protocolVersion + 1]) {
        const refused = yield* makeLinkedHome({ protocol, privateKey: otherHomeKey() })
        yield* refused.open
        expect(refused.state.refused).toEqual({
          reason:
            `this Cloud speaks protocols ${HomeProtocol.minProtocolVersion} to ${HomeProtocol.protocolVersion}, this Quai Home ${protocol}`,
          retryAfterSeconds: 3600
        })
        expect(refused.received.some((message) => message._tag === "Challenge")).toBe(false)
      }
      expect(yield* homeIds).toEqual([])

      const first = yield* makeLinkedHome()
      yield* first.connect
      const second = yield* makeLinkedHome({ privateKey: otherHomeKey() })
      yield* second.connect
      expect(first.state.closed).toBe(false)
      expect([...(yield* homeIds)].sort()).toEqual([first.homeId, second.homeId].sort())
      yield* second.disconnect
      expect(yield* homeIds).toEqual([first.homeId])
      expect(yield* (yield* HomeLinks).relayOf(second.homeId)).toEqual(Option.none())
    }).pipe(Effect.provide(Links)))

  it.effect("with QUAI_HOME_ID, only the homes it lists are served", () => {
    const ownKey = otherHomeKey()
    const ownId = HomeId.homeId(createPublicKey(ownKey).export({ format: "der", type: "spki" }).toString("base64"))
    const secondKey = otherHomeKey()
    const secondId = HomeId.homeId(
      createPublicKey(secondKey).export({ format: "der", type: "spki" }).toString("base64")
    )
    const pinned = Links.pipe(
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_HOME_ID: `${ownId.toUpperCase()}, ${secondId}` } }))
      )
    )
    return Effect.gen(function*() {
      const foreign = yield* makeLinkedHome({ privateKey: otherHomeKey() })
      yield* foreign.open
      expect(foreign.state.refused).toEqual({
        reason: `this Cloud serves ${ownId}, ${secondId} only (QUAI_HOME_ID), not ${foreign.homeId}`,
        retryAfterSeconds: 3600
      })
      expect(foreign.state.closed).toBe(true)

      const own = yield* makeLinkedHome({ privateKey: ownKey })
      yield* own.connect
      expect(own.state.welcomed).toBe(ownId)
      const second = yield* makeLinkedHome({ privateKey: secondKey })
      yield* second.connect
      expect(second.state.welcomed).toBe(secondId)
    }).pipe(Effect.provide(pinned))
  })

  it.effect("with QUAI_MAX_HOMES, a home past the cap is refused; the same home again isn't", () =>
    Effect.gen(function*() {
      const first = yield* makeLinkedHome()
      yield* first.connect
      const again = yield* makeLinkedHome({ privateKey: first.privateKey })
      yield* again.connect
      expect(again.state.welcomed).toBe(first.homeId)
      const second = yield* makeLinkedHome({ privateKey: otherHomeKey() })
      yield* second.open
      expect(second.state.refused).toEqual({ reason: "this Cloud serves 1 home at most", retryAfterSeconds: 300 })
      yield* again.disconnect
      yield* second.connect
      expect(second.state.welcomed).toBe(second.homeId)
    }).pipe(
      Effect.provide(
        Links.pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_MAX_HOMES: "1" } })))
        )
      )
    ))

  it.effect("a QUAI_HOME_ID that isn't a home id stops the Cloud", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(
        Links.pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_HOME_ID: "my-home" } })))
        )
      )))
      expect(String(exit)).toContain("QUAI_HOME_ID: a home id is 32 hex characters")
    }))

  it.effect("the same home connecting again replaces its old connection", () =>
    Effect.gen(function*() {
      const first = yield* makeLinkedHome({ answerApp: () => ({ status: 200, body: "\"first\"" }) })
      yield* first.connect
      const again = yield* makeLinkedHome({
        privateKey: first.privateKey,
        answerApp: () => ({ status: 200, body: "\"again\"" })
      })
      yield* again.connect
      expect(first.state.closed).toBe(true)
      const relay = Option.getOrThrow(yield* (yield* HomeLinks).relayOf(first.homeId))
      expect((yield* relay({ method: "GET", path: "/api/library", headers: {} })).body).toBe("\"again\"")
      expect(first.appRequests).toEqual([])
    }).pipe(Effect.provide(Links)))

  it.effect("pings every 20 s; a home silent for 60 s is dropped", () =>
    Effect.gen(function*() {
      const home = yield* makeLinkedHome({ deaf: true })
      yield* home.connect
      yield* TestClock.adjust("20 seconds")
      yield* settle
      expect(home.received.filter((message) => message._tag === "Ping")).toHaveLength(1)
      yield* TestClock.adjust("39 seconds")
      yield* settle
      expect(yield* homeIds).toEqual([home.homeId])
      yield* TestClock.adjust("1 second")
      yield* settle
      expect(yield* homeIds).toEqual([])
      expect(home.state.closed).toBe(true)
    }).pipe(Effect.provide(Links)))

  it.effect("what isn't part of the protocol is left: the connection stays", () =>
    Effect.gen(function*() {
      const home = yield* makeLinkedHome()
      yield* home.connect
      yield* home.sendRaw("not json")
      yield* home.sendRaw({ _tag: "CallResponse", id: "r1", status: 200, body: "" })
      expect(home.state.closed).toBe(false)
      expect(yield* homeIds).toEqual([home.homeId])
    }).pipe(Effect.provide(Links)))
})

const CloudJson = Schema.fromJsonString(HomeProtocol.CloudMessage)

/** Quai Home's side, by hand, over a real WebSocket to `/home`. */
const overWebSocket = <A, E, R>(
  script: (io: {
    readonly send: (message: object) => Effect.Effect<void, Socket.SocketError>
    readonly next: Effect.Effect<HomeProtocol.CloudMessage>
  }) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const url = yield* HttpServer.addressFormattedWith((address) =>
      Effect.succeed(`${address.replace(/^http/, "ws")}/home`)
    )
    const socket = yield* Socket.makeWebSocket(url)
    const incoming = yield* Queue.unbounded<HomeProtocol.CloudMessage>()
    const pull = yield* Socket.readerString(socket)
    yield* Effect.forkScoped(
      Effect.forever(Effect.flatMap(pull, (frames) =>
        Effect.forEach(frames, (frame) =>
          Effect.flatMap(Schema.decodeUnknownEffect(CloudJson)(frame), (message) =>
            Queue.offer(incoming, message)))))
        .pipe(Effect.ignore)
    )
    const writer = yield* socket.writer
    return yield* script({
      send: (message) =>
        writer.write(JSON.stringify(message)),
      next: Queue.take(incoming)
    })
  }).pipe(Effect.scoped)

const server = HttpRouter.serve(HomeRoute, { disableLogger: true }).pipe(
  Layer.provideMerge(Links),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeSocket.layerWebSocketConstructor)
)

describe("home link over a WebSocket", () => {
  const { privateKey } = generateKeyPairSync("ed25519")
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64")
  const hello = (protocol = HomeProtocol.protocolVersion) => ({
    _tag: "Hello",
    protocol,
    homeVersion: "test",
    publicKey
  })

  it.live("a good proof is welcomed and the home linked; a bad one and another protocol are refused", () =>
    Effect.gen(function*() {
      const refusedProof = yield* overWebSocket(({ send, next }) =>
        Effect.gen(function*() {
          yield* send(hello())
          const challenge = yield* next
          expect(challenge._tag).toBe("Challenge")
          yield* send({
            _tag: "Proof",
            signature: sign(null, Buffer.from("something else"), privateKey).toString("base64")
          })
          return yield* next
        })
      )
      expect(refusedProof).toMatchObject({ _tag: "Refused", retryAfterSeconds: 60 })

      const refusedProtocol = yield* overWebSocket(({ send, next }) => Effect.andThen(send(hello(99)), next))
      expect(refusedProtocol).toMatchObject({ _tag: "Refused", retryAfterSeconds: 3600 })

      yield* overWebSocket(({ send, next }) =>
        Effect.gen(function*() {
          yield* send(hello())
          const challenge = yield* next
          if (challenge._tag !== "Challenge") return yield* Effect.die("no challenge")
          expect(Buffer.from(challenge.nonce, "base64")).toHaveLength(32)
          const signature = sign(null, Buffer.from(HomeProtocol.challengePayload(challenge.nonce)), privateKey)
            .toString("base64")
          yield* send({ _tag: "Proof", signature })
          expect(yield* next).toEqual({
            _tag: "Welcome",
            homeId: HomeId.homeId(publicKey),
            version: "test",
            push: { configured: false, topic: "com.mathieuletyrant.quai" },
            publicAccess: { headers: [] }
          })
          // The Cloud asks it for nothing: the next it hears is a Ping, 20 s on.
          const links = yield* HomeLinks
          let linked = yield* links.homeIds
          for (let attempt = 0; attempt < 50 && linked.length === 0; attempt++) {
            yield* Effect.sleep("10 millis")
            linked = yield* links.homeIds
          }
          expect(linked).toEqual([HomeId.homeId(publicKey)])
        })
      )
    }).pipe(Effect.provide(server)))
})
