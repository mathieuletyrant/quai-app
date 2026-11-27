import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import { HomeApp } from "@quai/domain/App.ts"
import { pairingHash } from "@quai/domain/home/Devices.ts"
import * as DeviceToken from "@quai/domain/home/DeviceToken.ts"
import { PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Apns, ApnsError, type ApnsRequest } from "@quai/domain/push/Apns.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Effect, Fiber, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { TestClock } from "effect/testing"
import { generateKeyPairSync } from "node:crypto"
import { HomeLinks, HomeRoute, pushLimit, Timing } from "../../src/home/HomeLinks.ts"
import { Homes, HomesRoute } from "../../src/home/Homes.ts"
import { makeApns } from "../../src/push/ApnsClient.ts"
import { type AppAnswer, type FakeHomeOptions, makeFakeHome, settle } from "../fakeHome.ts"

/** The pushes the Cloud sent to APNs: a token starting with "dead" is gone for good. */
const pushes: Array<ApnsRequest> = []
const apnsSettings = { configured: true, keyId: "KEY123", teamId: "TEAM456", topic: "com.mathieuletyrant.quai" }
const FakeApns = Layer.sync(Apns, () => {
  pushes.length = 0
  return {
    configured: Effect.succeed(true),
    settings: apnsSettings,
    send: (request) =>
      Effect.suspend(() => {
        pushes.push(request)
        return request.deviceToken.startsWith("dead")
          ? Effect.fail(new ApnsError({ status: 410, reason: "Unregistered", tokenGone: true }))
          : Effect.void
      })
  }
})

const accessHeader = { name: "CF-Access-Client-Id", value: Redacted.make("abc.access") }
const publicUrl = "https://cloud.example.com"

/** main.ts's composition, with an APNs that records and a public address. */
const cloudWith = (apns: Layer.Layer<Apns>) =>
  HttpRouter.serve(Layer.mergeAll(HomeRoute, HomesRoute), { disableLogger: true }).pipe(
    Layer.provideMerge(Homes.layer(HomeApp)),
    Layer.provideMerge(HomeLinks.layer),
    Layer.provideMerge(Layer.mergeAll(
      apns,
      Layer.succeed(PublicAccess, PublicAccess.make(Option.some(publicUrl), [accessHeader])),
      Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })
    )),
    Layer.provideMerge(NodeHttpServer.layerTest)
  )
const Cloud = cloudWith(FakeApns)

const runsQuai = HomeProtocol.runsQuaiProtocolVersion

/** A fake Quai Home that runs Quai, connected: its routes answer `answerApp`. */
const homeRunningQuai = (options: FakeHomeOptions = {}) =>
  Effect.gen(function*() {
    const home = yield* makeFakeHome({ protocol: runsQuai, services: ["radarr"], ...options })
    yield* home.open
    yield* settle
    return home
  })

const echo = (request: HomeProtocol.AppRequest): AppAnswer => ({
  status: 200,
  body: JSON.stringify({ method: request.method, path: request.path, headers: request.headers, body: request.body })
})

const request = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: {
    readonly token?: string
    readonly body?: unknown
    readonly headers?: Readonly<Record<string, string>>
  } = {}
) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    let req = HttpClientRequest.make(method)(path)
    if (options.token !== undefined) req = HttpClientRequest.bearerToken(req, options.token)
    if (options.headers !== undefined) req = HttpClientRequest.setHeaders(req, options.headers)
    if (options.body !== undefined) req = HttpClientRequest.bodyJsonUnsafe(req, options.body)
    const response = yield* Effect.orDie(client.execute(req))
    const text = yield* Effect.orDie(response.text)
    return { status: response.status, text, contentType: response.headers["content-type"] }
  })

const json = (text: string) => JSON.parse(text) as Record<string, any>

const welcomeOf = (home: { readonly received: ReadonlyArray<HomeProtocol.CloudMessage> }) =>
  home.received.find((message) => message._tag === "Welcome")

describe("a Quai Home that runs Quai", () => {
  it.effect("is welcomed with the push key's settings and the public access, and asked for nothing", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      expect(welcomeOf(home)).toEqual({
        _tag: "Welcome",
        homeId: home.homeId,
        version: "test",
        push: apnsSettings,
        publicAccess: { url: publicUrl, headers: [{ name: "CF-Access-Client-Id", value: "abc.access" }] }
      })
      yield* TestClock.adjust("5 seconds")
      // No document, no call, no watch, no journal: the home keeps them to itself.
      expect(home.received.map((message) => message._tag)).toEqual(["Challenge", "Welcome"])
      expect(yield* (yield* Homes).homeIds).toEqual([])
    }).pipe(Effect.provide(Cloud)))

  it.effect("an older Quai Home is welcomed as before: no key settings, no access headers", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      expect(welcomeOf(home)).toEqual({ _tag: "Welcome", homeId: home.homeId })
      expect(yield* (yield* HomeLinks).relayHomes).toEqual([])
    }).pipe(Effect.provide(Cloud)))
})

describe("the app relay", () => {
  it.effect("passes the app's request to the home its token names, and answers what the home answered", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({ answerApp: echo })
      const other = yield* homeRunningQuai({
        answerApp: () => ({ status: 200, body: "\"other\"" }),
        privateKey: generateKeyPairSync("ed25519").privateKey
      })
      const token = DeviceToken.make(home.homeId)
      const answer = yield* request("POST", "/api/requests/12/approve?season=2", {
        token,
        body: { note: "ok" },
        headers: {
          "accept-language": "fr-FR",
          "x-forwarded-for": "203.0.113.7",
          cookie: "session=1",
          "x-quai-time": "1795780000000",
          "x-quai-nonce": "n-1",
          "x-quai-signature": "c2lnbmVk"
        }
      })
      expect(answer.status).toBe(200)
      expect(answer.contentType).toBe("application/json")
      expect(json(answer.text)).toEqual({
        method: "POST",
        path: "/api/requests/12/approve?season=2",
        // The token, the body's type, the language and the request's signature: nothing else of the
        // app's request reaches the home.
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "accept-language": "fr-FR",
          "x-quai-time": "1795780000000",
          "x-quai-nonce": "n-1",
          "x-quai-signature": "c2lnbmVk"
        },
        body: "{\"note\":\"ok\"}"
      })
      expect(other.appRequests).toEqual([])
    }).pipe(Effect.provide(Cloud)))

  it.effect("answers the home's status and body as they came: a 204, an error, another content type", () =>
    Effect.gen(function*() {
      const answers: Record<string, AppAnswer> = {
        "/api/devices/me": { status: 204 },
        "/api/fixes/x": { status: 404, body: "{\"_tag\":\"NotFound\"}" },
        "/api/openapi.json": { status: 200, body: "openapi", contentType: "text/plain" }
      }
      const home = yield* homeRunningQuai({ answerApp: (asked) => answers[asked.path] ?? { status: 500 } })
      const token = DeviceToken.make(home.homeId)
      expect(yield* request("DELETE", "/api/devices/me", { token })).toMatchObject({ status: 204, text: "" })
      expect(yield* request("GET", "/api/fixes/x", { token })).toMatchObject({
        status: 404,
        text: "{\"_tag\":\"NotFound\"}"
      })
      expect(yield* request("GET", "/api/openapi.json", { token })).toMatchObject({
        status: 200,
        text: "openapi",
        contentType: "text/plain"
      })
    }).pipe(Effect.provide(Cloud)))

  it.effect("relays the API's routes only: the console's never leave the home", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({ answerApp: echo })
      const token = DeviceToken.make(home.homeId)
      expect((yield* request("GET", "/console-api/devices", { token })).status).toBe(404)
      expect((yield* request("GET", "/api/../console-api/devices", { token })).status).toBe(404)
      expect(home.appRequests).toEqual([])
    }).pipe(Effect.provide(Cloud)))

  it.effect("is 503, as the API says a home is offline, when the home is gone or doesn't answer in time", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({ answerApp: () => "silent" })
      const token = DeviceToken.make(home.homeId)
      const waiting = yield* Effect.forkChild(request("GET", "/api/library", { token }))
      yield* settle
      yield* TestClock.adjust(`${HomeProtocol.appRequestTimeoutSeconds} seconds`)
      const late = yield* Fiber.join(waiting)
      expect(late.status).toBe(503)
      expect(json(late.text)).toEqual({ _tag: "HomeOffline", message: "Quai Home: Quai Home didn't answer in time" })

      const dropped = yield* Effect.forkChild(request("GET", "/api/library", { token }))
      yield* settle
      yield* home.disconnect
      expect(json((yield* Fiber.join(dropped)).text)).toEqual({
        _tag: "HomeOffline",
        message: "Quai Home is not connected"
      })
      // Gone: nothing to relay to, the Cloud's own answer for a home that isn't there.
      expect((yield* request("GET", "/api/library", { token })).status).toBe(503)
    }).pipe(Effect.provide(Cloud)))

  it.effect("the Cloud's own health needs no home", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({ answerApp: echo })
      const health = yield* request("GET", "/api/health")
      expect(json(health.text)).toMatchObject({ status: "ok", version: "test" })
      expect(home.appRequests).toEqual([])
    }).pipe(Effect.provide(Cloud)))

  it.effect("a token from before several homes goes to the only home that runs Quai, to none when there are two", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({ answerApp: () => ({ status: 200, body: "\"mine\"" }) })
      expect((yield* request("GET", "/api/library", { token: "an-old-secret" })).text).toBe("\"mine\"")
      yield* homeRunningQuai({
        answerApp: () => ({ status: 200, body: "\"other\"" }),
        privateKey: generateKeyPairSync("ed25519").privateKey
      })
      expect((yield* request("GET", "/api/library", { token: "an-old-secret" })).status).toBe(503)
      expect(home.appRequests).toHaveLength(1)
    }).pipe(Effect.provide(Cloud)))
})

describe("a pairing, relayed", () => {
  const pairing = (code: string) =>
    request("POST", "/api/devices", { body: { code, name: "iPhone", apnsEnvironment: "production" } })

  it.effect("goes to the home that said the code is one of its open ones, however it is typed", () =>
    Effect.gen(function*() {
      const paired = (name: string) => () => ({ status: 200, body: JSON.stringify({ home: name }) })
      const first = yield* homeRunningQuai({ answerApp: paired("first") })
      const second = yield* homeRunningQuai({
        answerApp: paired("second"),
        privateKey: generateKeyPairSync("ed25519").privateKey
      })
      yield* first.pairingCodes([pairingHash("AAAA1111")])
      yield* second.pairingCodes([pairingHash("BBBB2222"), pairingHash("CCCC3333")])
      expect(json((yield* pairing(" bbbb2222 ")).text)).toEqual({ home: "second" })
      expect(json((yield* pairing("AAAA1111")).text)).toEqual({ home: "first" })
      // The list replaces the one before: a code spent is no longer the home's.
      yield* second.pairingCodes([pairingHash("CCCC3333")])
      expect((yield* pairing("BBBB2222")).status).toBe(503)
      expect(first.appRequests).toHaveLength(1)
      expect(second.appRequests).toHaveLength(1)
    }).pipe(Effect.provide(Cloud)))

  it.effect("a code no home said: the only home that runs Quai refuses it itself; a home gone forgets its codes", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai({
        answerApp: () => ({ status: 401, body: "{\"_tag\":\"InvalidPairingCode\"}" })
      })
      expect((yield* pairing("ZZZZ9999")).status).toBe(401)
      yield* home.pairingCodes([pairingHash("AAAA1111")])
      yield* home.disconnect
      expect(yield* (yield* HomeLinks).pairingHome("AAAA1111")).toEqual(Option.none())
      expect((yield* pairing("AAAA1111")).status).toBe(503)
    }).pipe(Effect.provide(Cloud)))

  it.effect("an older Quai Home can't claim a code: only its documents, read by the Cloud, say it holds one", () =>
    Effect.gen(function*() {
      const older = yield* makeFakeHome()
      yield* older.connect
      yield* older.pairingCodes([pairingHash("AAAA1111")])
      expect(yield* (yield* HomeLinks).pairingHome("AAAA1111")).toEqual(Option.none())
    }).pipe(Effect.provide(Cloud)))

  it.effect("remembers at most the protocol's count of codes for a home", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      const codes = Array.from({ length: HomeProtocol.maxPairingCodes + 1 }, (_, index) => `CODE${index}`)
      yield* home.pairingCodes(codes.map(pairingHash))
      const links = yield* HomeLinks
      expect(yield* links.pairingHome(codes[0]!)).toEqual(Option.some(home.homeId))
      expect(yield* links.pairingHome(codes.at(-1)!)).toEqual(Option.none())
    }).pipe(Effect.provide(Cloud)))
})

describe("a push request", () => {
  const push = (id: string, deviceToken = "token-1") =>
    ({
      id,
      environment: "production",
      deviceToken,
      priority: 10,
      body: { aps: { timestamp: 1, event: "update", "content-state": {} } }
    }) as const

  it.effect("is sent to APNs with the Cloud's key, as the home built it", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      const answer = yield* home.push({ ...push("p1"), pushType: "alert", priority: 5 })
      expect(answer).toEqual(Option.some({ _tag: "PushResponse", id: "p1" }))
      const { id: _, ...sent } = { ...push("p1"), pushType: "alert", priority: 5 }
      expect(pushes).toEqual([sent])
    }).pipe(Effect.provide(Cloud)))

  it.effect("tells the home what APNs refused, and when a token is gone for good", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      expect(yield* home.push(push("p1", "dead-token"))).toEqual(
        Option.some({ _tag: "PushResponse", id: "p1", error: { status: 410, reason: "Unregistered", tokenGone: true } })
      )
    }).pipe(Effect.provide(Cloud)))

  it.effect("is refused from an older Quai Home, whose pushes the Cloud makes itself", () =>
    Effect.gen(function*() {
      const older = yield* makeFakeHome()
      yield* older.connect
      const answer = yield* older.push(push("p1"))
      expect(Option.getOrThrow(answer).error).toEqual({
        status: null,
        reason: "this Quai Home doesn't run Quai",
        tokenGone: false
      })
      expect(pushes).toEqual([])
    }).pipe(Effect.provide(Cloud)))

  it.effect("is refused past the limit of a minute, and taken again once the minute has passed", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      for (let count = 0; count < pushLimit; count++) {
        expect(Option.getOrThrow(yield* home.push(push(`p${count}`))).error).toBeUndefined()
      }
      const over = Option.getOrThrow(yield* home.push(push("over")))
      expect(over.error).toEqual({ status: null, reason: "too many pushes: try again in a minute", tokenGone: false })
      expect(pushes).toHaveLength(pushLimit)
      // Another home's pushes are counted apart.
      const other = yield* homeRunningQuai({ privateKey: generateKeyPairSync("ed25519").privateKey })
      expect(Option.getOrThrow(yield* other.push(push("o1"))).error).toBeUndefined()
      yield* TestClock.adjust(Timing.pushWindowMs)
      expect(Option.getOrThrow(yield* home.push(push("again"))).error).toBeUndefined()
    }).pipe(Effect.provide(Cloud)))

  it.effect("is refused, in words, by a Cloud that has no APNs key: its Welcome said so", () =>
    Effect.gen(function*() {
      const home = yield* homeRunningQuai()
      expect(welcomeOf(home)).toMatchObject({ push: { configured: false, topic: "com.mathieuletyrant.quai" } })
      expect(Option.getOrThrow(yield* home.push(push("p1"))).error?.reason).toBe("this Quai Cloud has no APNs key")
    }).pipe(Effect.provide(cloudWith(Layer.effect(Apns, makeApns(null))))))
})
