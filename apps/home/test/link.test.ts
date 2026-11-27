import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import { Effect, Fiber, Layer, Option, Queue } from "effect"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import { createPublicKey, randomBytes, verify } from "node:crypto"
import { join } from "node:path"
import { Calls } from "../src/Calls.ts"
import { CloudSeen } from "../src/CloudSeen.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { HomeStore } from "../src/HomeStore.ts"
import { Journal } from "../src/Journal.ts"
import { Link, notLinkedMessage, pushTimeoutMs, unreachableAfterMs } from "../src/Link.ts"
import { LocalHome, startingMessage } from "../src/LocalHome.ts"
import { ServiceSettings } from "../src/ServiceSettings.ts"
import { Watches } from "../src/Watches.ts"
import { configLayer, journalLayer, NodeFileSystem, tempDir } from "./config.ts"
import { close, cloud, type Connection, fakeSocket, noConnection, nothingSent, settle } from "./fakeCloud.ts"

/** Answers every call with a 200 echoing its path. */
const echoCalls = Layer.succeed(Calls, {
  run: (call) => Effect.succeed({ _tag: "CallResponse" as const, id: call.id, status: 200, body: call.path })
})

/** The real home key and store, in a temporary directory. */
const home = Layer.effect(HomeKey, Effect.flatMap(tempDir, (dir) => HomeKey.make(join(dir, "home.key")))).pipe(
  Layer.merge(Layer.effect(HomeStore, Effect.flatMap(tempDir, (dir) => HomeStore.make(join(dir, "home"))))),
  Layer.provide(NodeFileSystem.layer),
  Layer.merge(journalLayer)
)

/** What the Services page saves and the Cloud last linked to, in a temporary directory. */
const saved = Layer.mergeAll(
  Layer.effect(ServiceSettings, Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json")))),
  Layer.effect(CloudSeen, Effect.flatMap(tempDir, (dir) => CloudSeen.make(join(dir, "cloud.json"), "ws://cloud/home")))
).pipe(Layer.provide([configLayer({ sonarr: null }), NodeFileSystem.layer]))

const withLink = <A, E>(
  test: (
    fake: Effect.Success<typeof fakeSocket>
  ) => Effect.Effect<A, E, Link | LocalHome | HomeKey | Journal | ServiceSettings>
) =>
  Effect.gen(function*() {
    const fake = yield* fakeSocket
    return yield* test(fake).pipe(
      Effect.provide(Link.layer.pipe(
        Layer.provide([
          configLayer({ sonarr: null }),
          Layer.succeed(Socket.Socket, fake.socket)
        ]),
        Layer.provideMerge(LocalHome.layer),
        Layer.provide([configLayer({ sonarr: null }), Watches.layer.pipe(Layer.provideMerge(echoCalls))]),
        Layer.provideMerge(home),
        Layer.provideMerge(saved)
      ))
    )
  })

/** Opens a connection and gets through the handshake: the home then says its open pairing codes (none). */
const linked = (connections: Queue.Queue<Connection>, welcome: object = {}) =>
  Effect.gen(function*() {
    const connection = yield* Queue.take(connections)
    yield* Queue.take(connection.sent)
    yield* cloud(connection, { _tag: "Welcome", homeId: (yield* HomeKey).homeId, ...welcome })
    yield* settle
    expect(yield* Queue.take(connection.sent)).toEqual({ _tag: "PairingCodes", hashes: [] })
    return connection
  })

/** Stands for the home's routes: records what was asked, answers the contract's file as text, 204 for the rest. */
const routes = (asked: Array<unknown>, request: { readonly path: string }) => {
  asked.push(request)
  return request.path === "/api/openapi.json"
    ? { status: 200, body: "openapi", contentType: "text/plain" }
    : { status: 204, body: "" }
}

const push = {
  environment: "production",
  deviceToken: "token-1",
  priority: 10,
  body: { aps: { event: "update" } }
} as const

describe("link", () => {
  it.effect("says Hello with the public key, the services and where an iPhone opens them, proves the key, and is linked on Welcome", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const key = yield* HomeKey
        const connection = yield* Queue.take(connections)
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "Hello",
          protocol: HomeProtocol.protocolVersion,
          homeVersion: "dev",
          publicKey: key.publicKey,
          services: ["radarr", "qbittorrent", "jellyfin", "reclaimerr", "seerr", "cleanuparr", "prowlarr"],
          webUrls: { radarr: ["http://umbrel.local:7878", "https://radarr.example.com"] }
        })
        const nonce = randomBytes(32).toString("base64")
        yield* cloud(connection, { _tag: "Challenge", nonce })
        const proof = yield* Queue.take(connection.sent)
        expect(proof._tag).toBe("Proof")
        const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" })
        expect(
          verify(
            null,
            Buffer.from(HomeProtocol.challengePayload(nonce)),
            publicKey,
            Buffer.from(proof.signature, "base64")
          )
        ).toBe(true)

        const link = yield* Link
        expect(yield* link.linked).toBe(false)
        yield* cloud(connection, { _tag: "Welcome", homeId: key.homeId })
        yield* settle
        expect(yield* link.linked).toBe(true)
      })
    ))

  it.effect("answers the app's requests the Cloud relays with the home's routes, and ignores what it can't read", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const asked: Array<unknown> = []
        yield* link.answerApp((request) => Effect.succeed(routes(asked, request)))
        const connection = yield* linked(connections)
        yield* cloud(connection, "not json")
        yield* cloud(connection, { _tag: "Unknown" })
        yield* cloud(connection, {
          _tag: "AppRequest",
          id: "a1",
          method: "DELETE",
          path: "/api/devices/me?x=1",
          headers: { authorization: "Bearer t" }
        })
        expect(yield* Queue.take(connection.sent)).toEqual({ _tag: "AppResponse", id: "a1", status: 204, body: "" })
        yield* cloud(connection, {
          _tag: "AppRequest",
          id: "a2",
          method: "GET",
          path: "/api/openapi.json",
          headers: {}
        })
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "AppResponse",
          id: "a2",
          status: 200,
          contentType: "text/plain",
          body: "openapi"
        })
        expect(asked).toEqual([
          { method: "DELETE", path: "/api/devices/me?x=1", headers: { authorization: "Bearer t" } },
          { method: "GET", path: "/api/openapi.json", headers: {} }
        ])
      })
    ))

  it.effect("answers only the API's routes to the Cloud: never the console's, and 503 until its routes are up", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* linked(connections)
        const ask = (id: string, path: string) =>
          Effect.andThen(
            cloud(connection, { _tag: "AppRequest", id, method: "GET", path, headers: {} }),
            Queue.take(connection.sent)
          )
        expect(yield* ask("a1", "/api/library")).toEqual({
          _tag: "AppResponse",
          id: "a1",
          status: 503,
          body: JSON.stringify({ _tag: "HomeOffline", message: startingMessage })
        })
        let answered = 0
        yield* link.answerApp(() => Effect.sync(() => (answered++, { status: 200, body: "{}" })))
        expect((yield* ask("a2", "/console-api/devices")).status).toBe(404)
        expect((yield* ask("a3", "/api/../console-api/devices")).status).toBe(404)
        expect(answered).toBe(0)
        expect((yield* ask("a4", "/api/library")).status).toBe(200)
      })
    ))

  it.effect("has the Cloud send a push, and reads what APNs answered", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* linked(connections)
        const sent = yield* Effect.forkChild(Effect.exit(link.push({ ...push, pushType: "alert" })))
        const asked = yield* Queue.take(connection.sent)
        expect(asked).toEqual({ _tag: "PushRequest", id: asked.id, ...push, pushType: "alert" })
        yield* cloud(connection, { _tag: "PushResponse", id: asked.id })
        expect((yield* Fiber.join(sent))._tag).toBe("Success")

        const gone = yield* Effect.forkChild(Effect.flip(link.push(push)))
        const second = yield* Queue.take(connection.sent)
        expect(second.id).not.toBe(asked.id)
        yield* cloud(connection, {
          _tag: "PushResponse",
          id: second.id,
          error: { status: 410, reason: "Unregistered", tokenGone: true }
        })
        expect(yield* Fiber.join(gone)).toMatchObject({ status: 410, reason: "Unregistered", tokenGone: true })
        // An answer to a push nobody waits for is left alone: the link stays up.
        yield* cloud(connection, { _tag: "PushResponse", id: "unknown" })
        yield* settle
        expect(yield* link.linked).toBe(true)
      })
    ))

  it.effect("a push fails, as one APNs never got, while not linked, when the link drops and when the Cloud is too slow", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const unsent = { status: null, tokenGone: false }
        expect(yield* Effect.flip(link.push(push))).toMatchObject({ ...unsent, reason: notLinkedMessage })
        const connection = yield* linked(connections)

        const slow = yield* Effect.forkChild(Effect.flip(link.push(push)))
        yield* Queue.take(connection.sent)
        yield* TestClock.adjust(pushTimeoutMs)
        expect(yield* Fiber.join(slow)).toMatchObject({ ...unsent, reason: "Quai Cloud didn't answer in time" })

        const dropped = yield* Effect.forkChild(Effect.flip(link.push(push)))
        yield* Queue.take(connection.sent)
        yield* Queue.offer(connection.incoming, close)
        expect(yield* Fiber.join(dropped)).toMatchObject({ ...unsent, reason: notLinkedMessage })
      })
    ))

  it.effect("keeps what the Cloud says of itself in its Welcome: the push key's settings, the public access", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        expect(link.welcome()).toBeNull()
        const said = {
          push: { configured: true, keyId: "KEY123", teamId: "TEAM456", topic: "com.mathieuletyrant.quai" },
          publicAccess: { url: "https://cloud.example.com", headers: [{ name: "X-Key", value: "secret" }] }
        }
        yield* linked(connections, said)
        expect(link.welcome()).toMatchObject(said)
      })
    ))

  it.effect("tells the Cloud its open pairing codes on each Welcome, and each time one opens or is spent", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const { link: home } = yield* LocalHome
        yield* TestClock.setTime(1_000)
        yield* home.documents.put("pairing/aaa", { expiresAt: 5_000 })
        yield* home.documents.put("pairing/old", { expiresAt: 500 })
        const first = yield* Queue.take(connections)
        yield* Queue.take(first.sent)
        yield* cloud(first, { _tag: "Welcome", homeId: home.homeId })
        expect(yield* Queue.take(first.sent)).toEqual({ _tag: "PairingCodes", hashes: ["aaa"] })
        yield* home.documents.put("pairing/bbb", { expiresAt: 9_000 })
        expect(yield* Queue.take(first.sent)).toEqual({ _tag: "PairingCodes", hashes: ["aaa", "bbb"] })
        yield* home.documents.delete("pairing/aaa")
        expect(yield* Queue.take(first.sent)).toEqual({ _tag: "PairingCodes", hashes: ["bbb"] })
        // Another document changes nothing the Cloud needs to hear.
        yield* home.documents.put("devices/x", { id: "x" })
        expect(yield* nothingSent(first)).toBe(true)

        yield* Queue.offer(first.incoming, close)
        yield* TestClock.adjust("1 second")
        const second = yield* Queue.take(connections)
        yield* Queue.take(second.sent)
        yield* cloud(second, { _tag: "Welcome", homeId: home.homeId })
        expect(yield* Queue.take(second.sent)).toEqual({ _tag: "PairingCodes", hashes: ["bbb"] })
      })
    ))

  it.effect("answers none of what a Cloud asks a Quai Home that doesn't run Quai", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        const refused = (id: string) => ({ _tag: "Failed", id, reason: "this Quai Home runs Quai itself" })
        yield* cloud(connection, { _tag: "Call", id: "1", service: "radarr", method: "GET", path: "/api/v3/movie" })
        expect(yield* Queue.take(connection.sent)).toEqual(refused("1"))
        yield* cloud(connection, { _tag: "StoreList", id: "2", prefix: "" })
        expect(yield* Queue.take(connection.sent)).toEqual(refused("2"))
        yield* cloud(connection, { _tag: "StorePut", id: "3", key: "devices/x", value: {} })
        expect(yield* Queue.take(connection.sent)).toEqual(refused("3"))
        yield* cloud(connection, {
          _tag: "SetWatches",
          watches: [{ id: "w", service: "jellyfin", path: "/Sessions", everySeconds: 15 }]
        })
        yield* TestClock.adjust("30 seconds")
        expect(yield* nothingSent(connection)).toBe(true)
        expect(yield* (yield* LocalHome).link.documents.get("devices/x")).toEqual(Option.none())
      })
    ))

  it.effect("says in the journal when the Cloud is out of reach for a minute, and when it is back; never for a short drop", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const journal = yield* Journal
        const said = Effect.map(
          journal.read({ limit: 10 }),
          (page) => page.entries.filter((entry) => entry.source === "cloud").map((entry) => entry.kind)
        )
        const first = yield* linked(connections)
        // A drop of a second: linked again, nothing to say.
        yield* Queue.offer(first.incoming, close)
        yield* TestClock.adjust("1 second")
        const second = yield* linked(connections)
        expect(yield* said).toEqual([])

        // Out of reach: each try fails, 1 s, 2 s, 4 s… apart.
        yield* Queue.offer(second.incoming, close)
        for (let waited = 0; waited < unreachableAfterMs + 64_000; waited += 1_000) {
          yield* TestClock.adjust("1 second")
          const attempt = yield* Queue.poll(connections)
          if (Option.isSome(attempt)) yield* Queue.offer(attempt.value.incoming, close)
        }
        expect(yield* said).toEqual(["cloud.unreachable"])
        yield* TestClock.adjust("1 minute")
        yield* linked(connections)
        expect(yield* said).toEqual(["cloud.reachable", "cloud.unreachable"])
      })
    ))

  it.effect("writes a refusal to the journal once per reason: a Cloud too old for this Quai Home says so there", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const journal = yield* Journal
        const reason = "this Cloud speaks protocols 1 to 12, this Quai Home 13"
        for (let attempt = 0; attempt < 2; attempt++) {
          const connection = yield* Queue.take(connections)
          yield* cloud(connection, { _tag: "Refused", reason, retryAfterSeconds: 60 })
          yield* settle
          yield* TestClock.adjust("60 seconds")
        }
        const lines = (yield* journal.read({ limit: 10 })).entries.filter((entry) => entry.kind === "cloud.refused")
        expect(lines.map((entry) => entry.text)).toEqual([`Quai Cloud refused this Quai Home: ${reason}`])
      })
    ))

  it.effect("answers Ping with Pong, and reconnects after 60 s without one", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        for (let ping = 0; ping < 4; ping++) {
          yield* TestClock.adjust("20 seconds")
          yield* cloud(connection, { _tag: "Ping", at: ping })
          expect(yield* Queue.take(connection.sent)).toEqual({ _tag: "Pong", at: ping })
        }
        expect(yield* noConnection(connections)).toBe(true)

        yield* TestClock.adjust("59 seconds")
        expect(yield* noConnection(connections)).toBe(true)
        expect(yield* (yield* Link).linked).toBe(true)
        yield* TestClock.adjust("1 second")
        yield* settle
        expect(yield* (yield* Link).linked).toBe(false)
        yield* TestClock.adjust("1 second")
        const next = yield* Queue.take(connections)
        expect(yield* Queue.take(next.sent)).toMatchObject({ _tag: "Hello" })
      })
    ))

  it.effect("reconnects after 1 s, 2 s, 4 s…, and starts over after a Welcome", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const reconnectsAfter = (seconds: number) =>
          Effect.gen(function*() {
            yield* TestClock.adjust(`${seconds * 1000 - 1} millis`)
            expect(yield* noConnection(connections)).toBe(true)
            yield* TestClock.adjust("1 millis")
            return yield* Queue.take(connections)
          })
        const first = yield* Queue.take(connections)
        yield* Queue.offer(first.incoming, close)
        const second = yield* reconnectsAfter(1)
        yield* Queue.offer(second.incoming, close)
        const third = yield* reconnectsAfter(2)
        yield* Queue.offer(third.incoming, close)
        const fourth = yield* reconnectsAfter(4)
        yield* cloud(fourth, { _tag: "Welcome", homeId: (yield* HomeKey).homeId })
        yield* Queue.offer(fourth.incoming, close)
        yield* reconnectsAfter(1)
      })
    ))

  it.effect("waits retryAfterSeconds after a Refused", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const first = yield* Queue.take(connections)
        yield* cloud(first, { _tag: "Refused", reason: "bad proof", retryAfterSeconds: 120 })
        yield* settle
        yield* TestClock.adjust("119 seconds")
        expect(yield* noConnection(connections)).toBe(true)
        yield* TestClock.adjust("1 second")
        const second = yield* Queue.take(connections)
        expect(yield* Queue.take(second.sent)).toMatchObject({ _tag: "Hello" })
      })
    ))

  it.effect("tells the Cloud which services it reaches when one is set from the console", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        const settings = yield* ServiceSettings
        yield* settings.save("sonarr", { url: "http://sonarr:8989", secret: "k" })
        yield* settle
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "ServicesChanged",
          services: ["radarr", "sonarr", "qbittorrent", "jellyfin", "reclaimerr", "seerr", "cleanuparr", "prowlarr"]
        })
      })
    ))
})
