import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { pairingHash } from "@quai/domain/home/Devices.ts"
import { deviceKeyOf, signatureHeadersOf } from "@quai/domain/home/RequestSignature.ts"
import { Clock, Effect, Layer, Queue } from "effect"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import type { KeyObject } from "node:crypto"
import { join } from "node:path"
import { Calls } from "../src/Calls.ts"
import { CloudSeen } from "../src/CloudSeen.ts"
import { DomainLive } from "../src/Domain.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { HomeStore } from "../src/HomeStore.ts"
import { Link } from "../src/Link.ts"
import { LocalHome } from "../src/LocalHome.ts"
import { ServiceSettings } from "../src/ServiceSettings.ts"
import { Watches } from "../src/Watches.ts"
import { configLayer, journalLayer, NodeFileSystem, tempDir } from "./config.ts"
import { cloud, type Connection, fakeSocket, settle, welcomeOf } from "./fakeCloud.ts"

const movies = [{ id: 7, title: "Dune", year: 2021, tmdbId: 438631, hasFile: true, monitored: true, sizeOnDisk: 42 }]

/** Radarr lists one movie; anything else isn't there. Every call the domain made is kept. */
const called: Array<string> = []
const calls = Layer.sync(Calls, () => {
  called.length = 0
  return {
    run: (call) =>
      Effect.sync(() => {
        called.push(`${call.service} ${call.method} ${call.path.split("?")[0]}`)
        return call.service === "radarr" && call.path === "/api/v3/movie"
          ? { _tag: "Answered", status: 200, body: JSON.stringify(movies) }
          : { _tag: "Answered", status: 404, body: "" }
      })
  }
})

const config = configLayer({ sonarr: null })

/** Quai Home as main.ts composes it, without its port: the domain on the home answered in place, linked to a fake Cloud. */
const quaiHome = (socket: Socket.Socket) =>
  DomainLive.pipe(
    Layer.provideMerge(Link.layer.pipe(Layer.provide(Layer.succeed(Socket.Socket, socket)))),
    Layer.provideMerge(LocalHome.layer),
    Layer.provideMerge(Watches.layer),
    Layer.provideMerge(calls),
    Layer.provideMerge(Layer.mergeAll(
      Layer.effect(HomeKey, Effect.flatMap(tempDir, (dir) => HomeKey.make(join(dir, "home.key")))),
      Layer.effect(HomeStore, Effect.flatMap(tempDir, (dir) => HomeStore.make(join(dir, "home")))),
      Layer.effect(ServiceSettings, Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json")))),
      Layer.effect(
        CloudSeen,
        Effect.flatMap(tempDir, (dir) => CloudSeen.make(join(dir, "cloud.json"), "ws://cloud/home"))
      )
    )),
    Layer.provideMerge(journalLayer),
    Layer.provide([config, NodeFileSystem.layer, NodeHttpServer.layerHttpServices])
  )

const welcome = {
  push: { configured: true, keyId: "KEY123", teamId: "TEAM456", topic: "com.mathieuletyrant.quai" },
  publicAccess: { url: "https://cloud.example.com", headers: [{ name: "X-Access", value: "s3cret" }] }
}

/** What the home wrote to the Cloud and no test has read yet, per connection. */
const unread = new WeakMap<Connection, Array<any>>()

/** The next message of this kind the home wrote to the Cloud; the others wait for whoever asks for them. */
const nextOf = (connection: Connection, tag: string) =>
  Effect.gen(function*() {
    const waiting = unread.get(connection) ?? []
    unread.set(connection, waiting)
    while (true) {
      const index = waiting.findIndex((message) => message._tag === tag)
      if (index !== -1) return waiting.splice(index, 1)[0]
      waiting.push(yield* Queue.take(connection.sent))
    }
  })

/** Runs a test on a Quai Home linked to a fake Cloud that welcomed it. */
const linkedHome = <A, E>(
  test: (connection: Connection) => Effect.Effect<A, E, LocalHome | HomeKey | Link>
) =>
  Effect.gen(function*() {
    const fake = yield* fakeSocket
    return yield* Effect.gen(function*() {
      const connection = yield* Queue.take(fake.connections)
      yield* Queue.take(connection.sent)
      yield* cloud(connection, welcomeOf((yield* HomeKey).homeId, welcome))
      yield* settle
      return yield* test(connection)
    }).pipe(Effect.provide(quaiHome(fake.socket)))
  })

let requests = 0
/** One of the app's requests, as Quai Cloud relays it, and the home's answer. */
const app = (
  connection: Connection,
  method: string,
  path: string,
  options: {
    readonly token?: string
    readonly body?: unknown
    readonly headers?: Readonly<Record<string, string>>
  } = {}
) =>
  Effect.gen(function*() {
    const id = `a${++requests}`
    yield* cloud(connection, {
      _tag: "AppRequest",
      id,
      method,
      path,
      headers: {
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    })
    const answer = yield* nextOf(connection, "AppResponse")
    expect(answer.id).toBe(id)
    return { status: answer.status as number, json: answer.body === "" ? undefined : JSON.parse(answer.body) }
  })

/** One of the console's requests, answered in the home. */
const console_ = (method: "GET" | "POST", path: string, body?: unknown) =>
  Effect.gen(function*() {
    const answer = yield* (yield* LocalHome).console({
      method,
      path,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    return { status: answer.status, json: answer.body === "" ? undefined : JSON.parse(answer.body) }
  })

/** Pairs an iPhone: a code from the console, then the app's request through the Cloud. */
const pair = (connection: Connection) =>
  Effect.gen(function*() {
    const code = (yield* console_("POST", "/console-api/pairing-codes", { serverUrls: [] })).json.code as string
    const paired = yield* app(connection, "POST", "/api/devices", {
      body: { code, name: "iPhone", apnsEnvironment: "production", pushToStartToken: "pts-1" }
    })
    expect(paired.status).toBe(200)
    return { code, ...(paired.json as { deviceId: string; token: string }) }
  })

describe("Quai, run by Quai Home", () => {
  it.effect("pairs an iPhone: the code is the home's, the Cloud only hears its hash and carries the request", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const key = yield* HomeKey
        const qr = yield* console_("POST", "/console-api/pairing-codes", { serverUrls: ["http://cloud.lan:8787"] })
        expect(qr.status).toBe(200)
        // The QR code carries how the app reaches the Cloud, as the Cloud said in its Welcome.
        expect(qr.json.link).toBe(
          `quai://pair?code=${qr.json.code}&url=${encodeURIComponent("http://cloud.lan:8787")}&url=${
            encodeURIComponent("https://cloud.example.com")
          }&header=${encodeURIComponent("X-Access: s3cret")}`
        )
        expect(yield* nextOf(connection, "PairingCodes")).toEqual({ _tag: "PairingCodes", hashes: [] })
        expect(yield* nextOf(connection, "PairingCodes")).toEqual({
          _tag: "PairingCodes",
          hashes: [pairingHash(qr.json.code)]
        })

        const wrong = yield* app(connection, "POST", "/api/devices", {
          body: { code: "WRONG123", name: "iPhone", apnsEnvironment: "production" }
        })
        expect(wrong.status).toBe(403)
        const paired = yield* app(connection, "POST", "/api/devices", {
          body: { code: qr.json.code, name: "iPhone", apnsEnvironment: "production" }
        })
        expect(paired.status).toBe(200)
        expect(paired.json.token.startsWith(`${key.homeId}.`)).toBe(true)
        // Spent: no longer one of the home's open codes.
        expect(yield* nextOf(connection, "PairingCodes")).toEqual({ _tag: "PairingCodes", hashes: [] })
        const devices = yield* console_("GET", "/console-api/devices")
        expect(devices.json.map((device: { name: string }) => device.name)).toEqual(["iPhone"])
      })
    ))

  it.effect("answers the app through the Cloud with its own routes: the iPhone's token is checked at home", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const { token } = yield* pair(connection)
        expect((yield* app(connection, "GET", "/api/devices/me/preferences")).status).toBe(401)
        expect((yield* app(connection, "GET", "/api/devices/me/preferences", { token: `${token}x` })).status).toBe(401)
        const preferences = yield* app(connection, "GET", "/api/devices/me/preferences", { token })
        expect(preferences.status).toBe(200)
        expect(preferences.json).toHaveProperty("flows")
        expect((yield* app(connection, "GET", "/api/health")).json).toMatchObject({ status: "ok" })
      })
    ))

  it.effect("answers an iPhone paired with a device key only what it signed: the Cloud that carries can't ask", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const key = deviceKeyOf(Uint8Array.from({ length: 32 }, (_, index) => index + 1))
        const code = (yield* console_("POST", "/console-api/pairing-codes", { serverUrls: [] })).json.code as string
        const paired = yield* app(connection, "POST", "/api/devices", {
          body: { code, name: "iPhone", apnsEnvironment: "production", deviceKey: key.publicKey }
        })
        const token = paired.json.token as string
        const now = yield* Clock.currentTimeMillis
        const signedBy = (privateKey: KeyObject, method: string, path: string, body?: unknown) =>
          app(connection, method, path, {
            token,
            body,
            headers: signatureHeadersOf(privateKey, {
              method,
              path,
              body: body === undefined ? "" : JSON.stringify(body),
              time: now,
              nonce: `n${++requests}`
            })
          })
        expect((yield* signedBy(key.privateKey, "GET", "/api/devices/me/preferences")).status).toBe(200)
        expect((yield* signedBy(key.privateKey, "PATCH", "/api/devices/me", { name: "Renamed" })).status).toBe(204)
        // The token alone, as the Cloud sees it pass: not enough.
        const unsigned = yield* app(connection, "PATCH", "/api/devices/me", { token, body: { name: "Taken over" } })
        expect(unsigned).toMatchObject({ status: 403, json: { _tag: "InvalidSignature" } })
        const stranger = deviceKeyOf(Uint8Array.from({ length: 32 }, () => 9))
        expect((yield* signedBy(stranger.privateKey, "GET", "/api/library")).status).toBe(403)
        const devices = yield* console_("GET", "/console-api/devices")
        expect(devices.json).toMatchObject([{ name: "Renamed", signsRequests: true }])
      })
    ))

  it.effect("reads the services itself, on the LAN: the library comes from Radarr's own list", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const { token } = yield* pair(connection)
        const library = yield* app(connection, "GET", "/api/library", { token })
        expect(library.status).toBe(200)
        expect(library.json.items).toMatchObject([{ id: "movie:7", title: "Dune", status: "available" }])
        expect(called).toContain("radarr GET /api/v3/movie")
      })
    ))

  it.effect("never answers the console's routes to the Cloud, whoever asks", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const { token } = yield* pair(connection)
        expect((yield* app(connection, "GET", "/console-api/devices", { token })).status).toBe(404)
        expect((yield* app(connection, "POST", "/console-api/pairing-codes", { body: { serverUrls: [] } })).status)
          .toBe(404)
      })
    ))

  it.effect("shows the console the Cloud's push key and public address, as the Cloud said them: never a secret", () =>
    linkedHome(() =>
      Effect.gen(function*() {
        expect((yield* console_("GET", "/console-api/push-settings")).json).toEqual(welcome.push)
        expect((yield* console_("GET", "/console-api/connection-settings")).json).toEqual({
          publicUrl: "https://cloud.example.com",
          accessHeaderNames: ["X-Access"]
        })
      })
    ))

  it.effect("builds its pushes itself and has the Cloud send them: a flow's test starts on the iPhone", () =>
    linkedHome((connection) =>
      Effect.gen(function*() {
        const { deviceId } = yield* pair(connection)
        const played = yield* console_("POST", "/console-api/flows/download/test", { deviceIds: [deviceId] })
        expect(played.status).toBe(204)
        yield* TestClock.adjust("1 second")
        const push = yield* nextOf(connection, "PushRequest")
        expect(push).toMatchObject({ environment: "production", deviceToken: "pts-1", priority: 10 })
        expect(push.body.aps.event).toBe("start")
        yield* cloud(connection, { _tag: "PushResponse", id: push.id })
        yield* settle
        expect(yield* (yield* Link).linked).toBe(true)
      })
    ))
})

describe("Quai Home without a Quai Cloud", () => {
  it.effect("runs Quai all the same: its console pairs and reads; nothing is pushed, no key is shown", () =>
    Effect.gen(function*() {
      const qr = yield* console_("POST", "/console-api/pairing-codes", { serverUrls: [] })
      expect(qr.status).toBe(200)
      expect(qr.json.link).toBe(`quai://pair?code=${qr.json.code}`)
      expect((yield* console_("GET", "/console-api/push-settings")).json).toEqual({
        configured: false,
        topic: "com.mathieuletyrant.quai"
      })
      expect((yield* console_("GET", "/console-api/connection-settings")).json).toEqual({ accessHeaderNames: [] })
      expect((yield* console_("GET", "/api/health")).json).toMatchObject({ status: "ok" })
    }).pipe(Effect.provide(
      DomainLive.pipe(
        Layer.provideMerge(Link.unlinked),
        Layer.provideMerge(LocalHome.layer),
        Layer.provideMerge(Watches.layer),
        Layer.provideMerge(calls),
        Layer.provideMerge(Layer.mergeAll(
          Layer.effect(HomeKey, Effect.flatMap(tempDir, (dir) => HomeKey.make(join(dir, "home.key")))),
          Layer.effect(HomeStore, Effect.flatMap(tempDir, (dir) => HomeStore.make(join(dir, "home")))),
          Layer.effect(
            ServiceSettings,
            Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json")))
          )
        )),
        Layer.provideMerge(journalLayer),
        Layer.provide([config, NodeFileSystem.layer, NodeHttpServer.layerHttpServices])
      )
    )))
})
