import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Fiber, Layer, Option, Queue, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { HomeLink, HomeLinks, HomeRoute } from "../../src/home/HomeLink.ts"
import { makeFakeHome, settle, testLink } from "../fakeHome.ts"

const link = testLink
const linkTo = (homeId: string) => Effect.flatMap(Effect.service(HomeLinks), (links) => links.link(homeId))
const otherKey = () => generateKeyPairSync("ed25519").privateKey
const nextEvent = Effect.flatMap(Effect.service(HomeLink), (l) => l.nextEvent)

describe("home link", () => {
  it.effect("a good proof is welcomed under the key's home id, and the home's documents are loaded", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["radarr", "jellyfin"] })
      home.documents.set("flows/anime", { id: "anime" })
      yield* home.connect
      expect(home.state.welcomed).toBe(home.homeId)
      const l = yield* HomeLink
      expect(yield* l.home).toEqual(Option.some({ homeId: home.homeId, services: ["radarr", "jellyfin"], protocol: HomeProtocol.protocolVersion, webUrls: {} }))
      expect(yield* l.documents.get("flows/anime")).toEqual(Option.some({ id: "anime" }))
      expect(yield* nextEvent).toEqual({ _tag: "Ready", home: { homeId: home.homeId, services: ["radarr", "jellyfin"], protocol: HomeProtocol.protocolVersion, webUrls: {} } })
    }).pipe(Effect.provide(link)))

  it.effect("a bad proof and an older protocol are refused; a second home links on its own link", () =>
    Effect.gen(function*() {
      const l = yield* HomeLink
      const forger = yield* makeFakeHome({ badProof: true })
      yield* forger.open
      expect(forger.state.refused).toEqual({ reason: "the proof doesn't match the public key", retryAfterSeconds: 60 })
      expect(forger.state.closed).toBe(true)

      const old = yield* makeFakeHome({ protocol: 0 })
      yield* old.open
      expect(old.state.refused?.retryAfterSeconds).toBe(3600)
      expect(old.received.some((m) => m._tag === "Challenge")).toBe(false)
      expect(yield* l.home).toEqual(Option.none())

      const first = yield* makeFakeHome()
      first.documents.set("settings", { home: "first" })
      yield* first.connect
      const second = yield* makeFakeHome({ privateKey: otherKey() })
      second.documents.set("settings", { home: "second" })
      yield* second.connect
      expect(second.state.welcomed).toBe(second.homeId)
      expect(first.state.closed).toBe(false)
      expect(Option.map(yield* l.home, (h) => h.homeId)).toEqual(Option.some(first.homeId))
      expect(yield* l.documents.get("settings")).toEqual(Option.some({ home: "first" }))
      const other = yield* linkTo(second.homeId)
      expect(yield* other.documents.get("settings")).toEqual(Option.some({ home: "second" }))
      // Each home's events go to its own link.
      yield* second.webhook("radarr", { eventType: "Test" })
      expect((yield* nextEvent)._tag).toBe("Ready")
      expect((yield* other.nextEvent)._tag).toBe("Ready")
      expect(yield* other.nextEvent).toMatchObject({ _tag: "Webhook", body: { eventType: "Test" } })
      yield* second.disconnect
      expect(yield* other.nextEvent).toEqual({ _tag: "Gone", homeId: second.homeId })
      expect(Option.isSome(yield* l.home)).toBe(true)
    }).pipe(Effect.provide(link)))

  it.effect("with QUAI_HOME_ID, only the homes it lists are served", () => {
    const ownKey = otherKey()
    const ownId = HomeId.homeId(createPublicKey(ownKey).export({ format: "der", type: "spki" }).toString("base64"))
    const secondKey = otherKey()
    const secondId = HomeId.homeId(createPublicKey(secondKey).export({ format: "der", type: "spki" }).toString("base64"))
    const pinned = HomeLinks.layer.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_HOME_ID: `${ownId.toUpperCase()}, ${secondId}` } })))
    )
    return Effect.gen(function*() {
      const foreign = yield* makeFakeHome({ privateKey: otherKey() })
      yield* foreign.open
      expect(foreign.state.refused).toEqual({
        reason: `this Cloud serves ${ownId}, ${secondId} only (QUAI_HOME_ID), not ${foreign.homeId}`,
        retryAfterSeconds: 3600
      })
      expect(foreign.state.closed).toBe(true)
      expect(yield* (yield* linkTo(foreign.homeId)).home).toEqual(Option.none())

      const own = yield* makeFakeHome({ privateKey: ownKey })
      yield* own.connect
      expect(own.state.welcomed).toBe(ownId)
      const second = yield* makeFakeHome({ privateKey: secondKey })
      yield* second.connect
      expect(second.state.welcomed).toBe(secondId)
    }).pipe(Effect.provide(pinned))
  })

  it.effect("with QUAI_MAX_HOMES, a home past the cap is refused; the same home again isn't", () =>
    Effect.gen(function*() {
      const first = yield* makeFakeHome()
      yield* first.connect
      const again = yield* makeFakeHome({ privateKey: first.privateKey })
      yield* again.connect
      expect(again.state.welcomed).toBe(first.homeId)
      const second = yield* makeFakeHome({ privateKey: otherKey() })
      yield* second.open
      expect(second.state.refused).toEqual({ reason: "this Cloud serves 1 home at most", retryAfterSeconds: 300 })
      yield* again.disconnect
      yield* second.connect
      expect(second.state.welcomed).toBe(second.homeId)
    }).pipe(Effect.provide(HomeLinks.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_MAX_HOMES: "1" } })))))))

  it.effect("a home not connected is forgotten, with its events; a connected one isn't", () =>
    Effect.gen(function*() {
      const links = yield* HomeLinks
      const home = yield* makeFakeHome()
      yield* home.connect
      expect(yield* links.forget(home.homeId)).toBe(false)
      expect(yield* links.nextReady).toBe(home.homeId)
      yield* home.disconnect
      expect(yield* links.forget(home.homeId)).toBe(true)
      const fresh = yield* links.link(home.homeId)
      expect(yield* Effect.timeoutOption(fresh.nextEvent, "1 millis").pipe(Effect.forkChild, Effect.tap(() => TestClock.adjust("1 millis")), Effect.flatMap(Fiber.join))).toEqual(Option.none())
    }).pipe(Effect.provide(HomeLinks.layer)))

  it.effect("a QUAI_HOME_ID that isn't a home id stops the Cloud", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(
        HomeLinks.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_HOME_ID: "my-home" } }))))
      )))
      expect(String(exit)).toContain("QUAI_HOME_ID: a home id is 32 hex characters")
    }))

  it.effect("a Home one protocol behind is still served; one from the future is refused", () =>
    Effect.gen(function*() {
      const future = yield* makeFakeHome({ protocol: HomeProtocol.protocolVersion + 1 })
      yield* future.open
      expect(future.state.refused?.retryAfterSeconds).toBe(3600)
      const older = yield* makeFakeHome({ protocol: HomeProtocol.minProtocolVersion })
      yield* older.connect
      expect(older.state.welcomed).toBe(older.homeId)
    }).pipe(Effect.provide(link)))

  it.effect("the same home connecting again replaces its old connection", () =>
    Effect.gen(function*() {
      const first = yield* makeFakeHome()
      yield* first.connect
      const again = yield* makeFakeHome({ privateKey: first.privateKey })
      again.documents.set("settings", { fresh: true })
      yield* again.connect
      expect(first.state.closed).toBe(true)
      const l = yield* HomeLink
      expect(yield* l.documents.get("settings")).toEqual(Option.some({ fresh: true }))
      yield* l.documents.put("settings", { saved: 1 })
      expect(again.documents.get("settings")).toEqual({ saved: 1 })
      expect(first.documents.has("settings")).toBe(false)
    }).pipe(Effect.provide(link)))

  it.effect("pings every 20 s; a home silent for 60 s is dropped", () =>
    Effect.gen(function*() {
      const l = yield* HomeLink
      const home = yield* makeFakeHome({ deaf: true })
      yield* home.connect
      yield* TestClock.adjust("20 seconds")
      yield* settle
      expect(home.received.filter((m) => m._tag === "Ping")).toHaveLength(1)
      yield* TestClock.adjust("39 seconds")
      yield* settle
      expect(Option.isSome(yield* l.home)).toBe(true)
      yield* TestClock.adjust("1 second")
      yield* settle
      expect(yield* l.home).toEqual(Option.none())
      expect(home.state.closed).toBe(true)
    }).pipe(Effect.provide(link)))

  it.effect("calls are answered by id, fail after 15 s without an answer, and fail at once without a home", () =>
    Effect.gen(function*() {
      const l = yield* HomeLink
      expect((yield* Effect.flip(l.call({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))).reason).toBe("offline")
      // Not strict: the allowlist refusing `sonarr GET /x` is what this test checks.
      const home = yield* makeFakeHome({
        strict: false,
        answer: (call) => call.service === "radarr" ? { json: { version: "5" } } : { silent: true }
      })
      yield* home.connect
      expect(yield* l.call({ service: "radarr", method: "GET", path: "/api/v3/system/status" })).toEqual({ status: 200, body: "{\"version\":\"5\"}" })
      expect(yield* Effect.flip(l.call({ service: "sonarr", method: "GET", path: "/x" }))).toMatchObject({ reason: "failed", message: "not allowed" })
      const waiting = yield* Effect.forkChild(Effect.flip(l.call({ service: "jellyfin", method: "GET", path: "/Sessions" })))
      yield* settle
      yield* TestClock.adjust("15 seconds")
      expect((yield* Fiber.join(waiting)).reason).toBe("timeout")
      expect(home.notAllowed).toEqual(["sonarr GET /x"])
    }).pipe(Effect.provide(link)))

  it.effect("snapshots, failed watches and webhooks become events; a disconnect is Gone and stops writes", () =>
    Effect.gen(function*() {
      const l = yield* HomeLink
      const home = yield* makeFakeHome()
      yield* home.connect
      expect((yield* nextEvent)._tag).toBe("Ready")
      yield* l.setWatches([{ id: "w", service: "jellyfin", path: "/Sessions", everySeconds: 15 }])
      yield* settle
      expect(home.watch("w")?.path).toBe("/Sessions")
      yield* home.snapshot("w", [])
      yield* home.failWatch("w")
      yield* home.webhook("radarr", { eventType: "Test" })
      expect(yield* nextEvent).toEqual({ _tag: "Snapshot", watchId: "w", status: 200, body: "[]" })
      expect(yield* nextEvent).toEqual({ _tag: "WatchFailed", watchId: "w", reason: "unreachable" })
      expect(yield* nextEvent).toMatchObject({ _tag: "Webhook", service: "radarr", body: { eventType: "Test" } })
      yield* home.disconnect
      expect(yield* nextEvent).toEqual({ _tag: "Gone", homeId: home.homeId })
      expect((yield* Effect.flip(l.documents.put("settings", {}))).reason).toBe("offline")
    }).pipe(Effect.provide(link)))
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
    const url = yield* HttpServer.addressFormattedWith((address) => Effect.succeed(`${address.replace(/^http/, "ws")}/home`))
    const socket = yield* Socket.makeWebSocket(url)
    const incoming = yield* Queue.unbounded<HomeProtocol.CloudMessage>()
    const pull = yield* Socket.readerString(socket)
    yield* Effect.forkScoped(Effect.forever(Effect.flatMap(pull, (frames) =>
      Effect.forEach(frames, (frame) => Effect.flatMap(Schema.decodeUnknownEffect(CloudJson)(frame), (m) => Queue.offer(incoming, m)))
    )).pipe(Effect.ignore))
    const writer = yield* socket.writer
    return yield* script({ send: (message) => writer.write(JSON.stringify(message)), next: Queue.take(incoming) })
  }).pipe(Effect.scoped)

const server = HttpRouter.serve(HomeRoute, { disableLogger: true }).pipe(
  Layer.provideMerge(link),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeSocket.layerWebSocketConstructor)
)

describe("home link over a WebSocket", () => {
  const { privateKey } = generateKeyPairSync("ed25519")
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64")
  const hello = (protocol = HomeProtocol.protocolVersion) =>
    ({ _tag: "Hello", protocol, homeVersion: "test", publicKey, services: ["radarr"] })

  it.live("a good proof is welcomed and the home loaded; a bad one and another protocol are refused", () =>
    Effect.gen(function*() {
      const refusedProof = yield* overWebSocket(({ send, next }) =>
        Effect.gen(function*() {
          yield* send(hello())
          const challenge = yield* next
          expect(challenge._tag).toBe("Challenge")
          yield* send({ _tag: "Proof", signature: sign(null, Buffer.from("something else"), privateKey).toString("base64") })
          return yield* next
        }))
      expect(refusedProof).toMatchObject({ _tag: "Refused", retryAfterSeconds: 60 })

      const refusedProtocol = yield* overWebSocket(({ send, next }) => Effect.andThen(send(hello(99)), next))
      expect(refusedProtocol).toMatchObject({ _tag: "Refused", retryAfterSeconds: 3600 })

      yield* overWebSocket(({ send, next }) =>
        Effect.gen(function*() {
          yield* send(hello())
          const challenge = yield* next
          if (challenge._tag !== "Challenge") return yield* Effect.die("no challenge")
          expect(Buffer.from(challenge.nonce, "base64")).toHaveLength(32)
          const signature = sign(null, Buffer.from(HomeProtocol.challengePayload(challenge.nonce)), privateKey).toString("base64")
          yield* send({ _tag: "Proof", signature })
          expect(yield* next).toEqual({ _tag: "Welcome", homeId: HomeId.homeId(publicKey) })
          const list = yield* next
          if (list._tag !== "StoreList") return yield* Effect.die("no StoreList")
          expect(list.prefix).toBe("")
          yield* send({ _tag: "StoreDocuments", id: list.id, documents: [{ key: "settings", value: { a: 1 } }] })
          const l = yield* linkTo(HomeId.homeId(publicKey))
          let home = yield* l.home
          for (let i = 0; i < 50 && Option.isNone(home); i++) {
            yield* Effect.sleep("10 millis")
            home = yield* l.home
          }
          expect(Option.map(home, (h) => h.homeId)).toEqual(Option.some(HomeId.homeId(publicKey)))
          expect(yield* l.documents.get("settings")).toEqual(Option.some({ a: 1 }))
        }))
    }).pipe(Effect.provide(server)))
})
