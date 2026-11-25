import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol, journalId } from "@quai/api"
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
import { heldWebhooksLimit, Link } from "../src/Link.ts"
import { ServiceSettings } from "../src/ServiceSettings.ts"
import { Watches } from "../src/Watches.ts"
import { configLayer, journalLayer, NodeFileSystem, tempDir } from "./config.ts"

const close = Symbol("close")

/** One connection the home opened: what the cloud sends it, and what it wrote. */
interface Connection {
  readonly incoming: Queue.Queue<string | typeof close>
  readonly sent: Queue.Queue<any>
}

/** A Socket whose every reader acquisition is a new connection, handed to the test. */
const fakeSocket = Effect.gen(function*() {
  const connections = yield* Queue.unbounded<Connection>()
  let latest: Connection | null = null
  const socket = Socket.make({
    reader: Effect.gen(function*() {
      const connection: Connection = {
        incoming: yield* Queue.unbounded<string | typeof close>(),
        sent: yield* Queue.unbounded<any>()
      }
      latest = connection
      yield* Queue.offer(connections, connection)
      return {
        pull: Effect.flatMap(Queue.take(connection.incoming), (frame) =>
          frame === close
            ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))
            : Effect.succeed([frame] as const)),
        upgrade: Socket.SocketUpgradeError.unsupported
      }
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        Queue.offer(latest!.sent, typeof chunk === "string" ? JSON.parse(chunk) : chunk).pipe(Effect.asVoid),
      writeAll: () => Effect.void
    })
  })
  return { socket, connections }
})

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
  test: (fake: Effect.Success<typeof fakeSocket>) => Effect.Effect<A, E, Link | HomeKey | Journal | ServiceSettings>
) =>
  Effect.gen(function*() {
    const fake = yield* fakeSocket
    return yield* test(fake).pipe(
      Effect.provide(Link.layer.pipe(
        Layer.provide([
          configLayer({ sonarr: null }),
          Watches.layer.pipe(Layer.provideMerge(echoCalls)),
          Layer.succeed(Socket.Socket, fake.socket)
        ]),
        Layer.provideMerge(home),
        Layer.provideMerge(saved)
      ))
    )
  })

const cloud = (connection: Connection, message: object | string) =>
  Queue.offer(connection.incoming, typeof message === "string" ? message : JSON.stringify(message))

/** Lets forked fibers run up to their next wait. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 })

const nothingSent = (connection: Connection) =>
  Effect.map(Effect.andThen(settle, Queue.size(connection.sent)), (size) => size === 0)
const noConnection = (connections: Queue.Queue<Connection>) =>
  Effect.map(Effect.andThen(settle, Queue.poll(connections)), Option.isNone)

/** Opens a connection and gets through the handshake. */
const linked = (connections: Queue.Queue<Connection>) =>
  Effect.gen(function*() {
    const connection = yield* Queue.take(connections)
    yield* Queue.take(connection.sent)
    yield* cloud(connection, { _tag: "Welcome", homeId: (yield* HomeKey).homeId })
    yield* settle
    return connection
  })

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

  it.effect("answers a Call, and ignores what it can't read", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        yield* cloud(connection, "not json")
        yield* cloud(connection, { _tag: "Shutdown" })
        yield* cloud(connection, {
          _tag: "Call",
          id: "42",
          service: "radarr",
          method: "GET",
          path: "/api/v3/system/status"
        })
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "CallResponse",
          id: "42",
          status: 200,
          body: "/api/v3/system/status"
        })
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

  it.effect("sends webhooks while linked, holds them while not and sends them once welcomed again", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* linked(connections)
        const webhook = (eventType: string) =>
          ({ _tag: "WebhookReceived", service: "sonarr", receivedAt: 0, body: { eventType } }) as const
        yield* link.send(webhook("Grab"))
        expect(yield* Queue.take(connection.sent)).toEqual(webhook("Grab"))

        // The hosted Cloud's link drops for a few seconds: a grab in between isn't lost.
        yield* Queue.offer(connection.incoming, close)
        yield* settle
        yield* link.send(webhook("Download"))
        yield* link.send(webhook("ManualInteractionRequired"))
        expect(yield* nothingSent(connection)).toBe(true)
        yield* TestClock.adjust("1 second")
        const next = yield* Queue.take(connections)
        yield* Queue.take(next.sent)
        // Nothing before the Cloud welcomes the home.
        expect(yield* nothingSent(next)).toBe(true)
        yield* cloud(next, { _tag: "Welcome", homeId: (yield* HomeKey).homeId })
        yield* settle
        expect(yield* Queue.take(next.sent)).toEqual(webhook("Download"))
        expect(yield* Queue.take(next.sent)).toEqual(webhook("ManualInteractionRequired"))
      })
    ))

  it.effect(`holds at most ${heldWebhooksLimit} webhooks, the newest`, () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        for (let webhook = 0; webhook < heldWebhooksLimit + 5; webhook++) {
          yield* link.send({ _tag: "WebhookReceived", service: "radarr", receivedAt: webhook, body: {} })
        }
        const connection = yield* linked(connections)
        yield* settle
        const sent: Array<any> = []
        while ((yield* Queue.size(connection.sent)) > 0) sent.push(yield* Queue.take(connection.sent))
        const webhooks = sent.filter((message) => message._tag === "WebhookReceived")
        expect(webhooks).toHaveLength(heldWebhooksLimit)
        expect(webhooks[0].receivedAt).toBe(5)
      })
    ))

  it.effect("runs store operations in order and answers each", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        yield* cloud(connection, { _tag: "StorePut", id: "1", key: "flows/download", value: { on: true } })
        yield* cloud(connection, { _tag: "StorePut", id: "2", key: "devices/a", value: 1 })
        yield* cloud(connection, { _tag: "StoreList", id: "3", prefix: "flows/" })
        yield* cloud(connection, { _tag: "StoreDelete", id: "4", key: "flows/download" })
        yield* cloud(connection, { _tag: "StoreList", id: "5", prefix: "" })
        yield* cloud(connection, { _tag: "StorePut", id: "6", key: "../escape", value: 1 })
        const answers = [] as Array<unknown>
        for (let answer = 0; answer < 6; answer++) answers.push(yield* Queue.take(connection.sent))
        expect(answers).toEqual([
          { _tag: "StoreDone", id: "1" },
          { _tag: "StoreDone", id: "2" },
          { _tag: "StoreDocuments", id: "3", documents: [{ key: "flows/download", value: { on: true } }] },
          { _tag: "StoreDone", id: "4" },
          { _tag: "StoreDocuments", id: "5", documents: [{ key: "devices/a", value: 1 }] },
          { _tag: "Failed", id: "6", reason: "invalid key: ../escape" }
        ])
      })
    ))

  it.effect("keeps the Cloud's journal lines and answers a read with a page, in the order sent", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* linked(connections)
        const line = (index: number, source: string) => ({
          id: journalId(1_000 + index, "c", index),
          at: 1_000 + index,
          level: "info",
          source,
          kind: "media.grabbed",
          text: `line ${index}`
        })
        yield* cloud(connection, {
          _tag: "JournalAppend",
          entries: [line(1, "radarr"), line(2, "sonarr"), line(3, "radarr")]
        })
        yield* cloud(connection, { _tag: "JournalRead", id: "r9", query: { limit: 1, sources: ["radarr"] } })
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "JournalPage",
          id: "r9",
          entries: [line(3, "radarr")],
          more: true
        })
      })
    ))

  it.effect("hands its own journal lines to the Cloud once linked", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const journal = yield* Journal
        yield* journal.note({ level: "warn", source: "radarr", kind: "call.refused", text: "refused" })
        const connection = yield* linked(connections)
        const noted = yield* Queue.take(connection.sent)
        expect(noted._tag).toBe("JournalNoted")
        expect(noted.entries.map((entry: { text: string }) => entry.text)).toEqual(["refused"])
        const page = yield* journal.read({ limit: 10 })
        expect(page.entries.map((entry) => entry.text)).toEqual(["refused"])
      })
    ))

  it.effect("polls watches while linked, stops on disconnect, and sends snapshots again after the next Welcome", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const watches = {
          _tag: "SetWatches",
          watches: [{ id: "w", service: "jellyfin", path: "/Sessions", everySeconds: 15 }]
        }
        const snapshot = { _tag: "WatchSnapshot", watchId: "w", status: 200, body: "/Sessions" }
        const first = yield* linked(connections)
        yield* cloud(first, watches)
        expect(yield* Queue.take(first.sent)).toEqual(snapshot)
        yield* TestClock.adjust("15 seconds")
        expect(yield* nothingSent(first)).toBe(true)

        yield* Queue.offer(first.incoming, close)
        yield* settle
        yield* TestClock.adjust("1 second")
        const second = yield* linked(connections)
        yield* TestClock.adjust("30 seconds")
        expect(yield* nothingSent(second)).toBe(true)
        yield* cloud(second, watches)
        expect(yield* Queue.take(second.sent)).toEqual(snapshot)
      })
    ))

  it.effect("relays a console request to the Cloud and its answer back", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* linked(connections)
        const answer = yield* Effect.forkChild(link.console({ method: "GET", path: "/console-api/devices" }))
        yield* settle
        const request = yield* Queue.take(connection.sent)
        expect(request).toEqual({ _tag: "ConsoleRequest", id: request.id, method: "GET", path: "/console-api/devices" })
        yield* cloud(connection, { _tag: "ConsoleResponse", id: request.id, status: 200, body: "[]" })
        expect(yield* Fiber.join(answer)).toEqual({ status: 200, body: "[]" })
      })
    ))

  it.effect("stays linked after a console answer: the next request goes over the same link", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* linked(connections)
        for (const path of ["/console-api/devices", "/console-api/push-settings"]) {
          const answer = yield* Effect.forkChild(link.console({ method: "GET", path }))
          yield* settle
          const request = yield* Queue.take(connection.sent)
          yield* cloud(connection, { _tag: "ConsoleResponse", id: request.id, status: 200, body: "[]" })
          expect(yield* Fiber.join(answer)).toEqual({ status: 200, body: "[]" })
          yield* settle
          expect(yield* link.linked).toBe(true)
        }
      })
    ))

  it.effect("a console request fails while the Cloud hasn't welcomed this home, and when the link drops", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* Queue.take(connections)
        yield* settle
        expect((yield* Effect.flip(link.console({ method: "GET", path: "/api/health" })))._tag).toBe("CloudUnreachable")
        yield* Queue.take(connection.sent)
        yield* cloud(connection, { _tag: "Welcome", homeId: (yield* HomeKey).homeId })
        yield* settle
        const answer = yield* Effect.forkChild(link.console({ method: "GET", path: "/api/health" }))
        yield* settle
        yield* Queue.offer(connection.incoming, close)
        expect((yield* Effect.flip(Fiber.join(answer)))._tag).toBe("CloudUnreachable")
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
