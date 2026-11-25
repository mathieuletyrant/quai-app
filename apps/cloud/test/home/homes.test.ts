import { describe, expect, it } from "@effect/vitest"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { TestClock } from "effect/testing"
import { createHash, generateKeyPairSync } from "node:crypto"
import { HomeApp } from "../../src/App.ts"
import * as DeviceToken from "../../src/home/DeviceToken.ts"
import { HomeLinks, HomeRoute } from "../../src/home/HomeLink.ts"
import { Homes, HomesRoute, Timing } from "../../src/home/Homes.ts"
import { Apns } from "../../src/push/Apns.ts"
import { PublicAccess } from "../../src/PublicAccess.ts"
import { ServerInfo } from "../../src/Version.ts"
import { type FakeHome, makeFakeHome, settle } from "../fakeHome.ts"

/** main.ts's composition: the links, a home app per home, and the routes that pick it. */
const Cloud = HttpRouter.serve(Layer.mergeAll(HomeRoute, HomesRoute), { disableLogger: true }).pipe(
  Layer.provideMerge(Homes.layer(HomeApp)),
  Layer.provideMerge(Layer.mergeAll(
    HomeLinks.layer,
    Layer.effect(Apns, Apns.make(null)),
    Layer.succeed(PublicAccess, PublicAccess.make(Option.none(), [])),
    Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })
  )),
  Layer.provideMerge(NodeHttpServer.layerTest)
)

const otherKey = () => generateKeyPairSync("ed25519").privateKey

/** Links a fake home and waits until its app is built. */
const linked = (home: FakeHome) =>
  Effect.gen(function*() {
    yield* home.connect
    yield* settle
  })

const request = (method: "GET" | "POST", path: string, options: { readonly token?: string; readonly body?: unknown } = {}) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    let req = method === "GET" ? HttpClientRequest.get(path) : HttpClientRequest.post(path)
    if (options.token !== undefined) req = HttpClientRequest.bearerToken(req, options.token)
    if (options.body !== undefined) req = HttpClientRequest.bodyJsonUnsafe(req, options.body)
    const response = yield* Effect.orDie(client.execute(req))
    const text = yield* Effect.orDie(response.text)
    const body = (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return text === "" ? undefined : text
      }
    })()
    return { status: response.status, json: body }
  })

/** Pairs an iPhone with a home: a code from its console, then the iPhone's request on the public port. */
const pair = (home: FakeHome, name: string) =>
  Effect.gen(function*() {
    const qr = yield* home.console({ method: "POST", path: "/console-api/pairing-codes", body: JSON.stringify({ serverUrls: [] }) })
    const { code } = qr.json as { code: string }
    const paired = yield* request("POST", "/api/devices", { body: { code, name, apnsEnvironment: "production" } })
    expect(paired.status).toBe(200)
    return paired.json as { deviceId: string; token: string }
  })

describe("homes", () => {
  it.effect("two homes link to one Cloud; each iPhone reaches its own home, never the other's", () =>
    Effect.gen(function*() {
      const first = yield* makeFakeHome()
      const second = yield* makeFakeHome({ privateKey: otherKey() })
      yield* linked(first)
      yield* linked(second)
      expect([...(yield* (yield* Homes).homeIds)].sort()).toEqual([first.homeId, second.homeId].sort())

      const mine = yield* pair(first, "Mathieu")
      const theirs = yield* pair(second, "Neighbour")
      expect(DeviceToken.homeOf(mine.token)).toEqual(Option.some(first.homeId))
      expect(DeviceToken.homeOf(theirs.token)).toEqual(Option.some(second.homeId))
      // Each home keeps its own iPhone, on its own disk.
      expect([...first.documents.keys()].filter((key) => key.startsWith("devices/"))).toEqual([`devices/${mine.deviceId}`])
      expect([...second.documents.keys()].filter((key) => key.startsWith("devices/"))).toEqual([`devices/${theirs.deviceId}`])
      expect(((yield* first.console({ method: "GET", path: "/console-api/devices" })).json as Array<{ name: string }>).map((device) => device.name)).toEqual(["Mathieu"])
      expect(((yield* second.console({ method: "GET", path: "/console-api/devices" })).json as Array<{ name: string }>).map((device) => device.name)).toEqual(["Neighbour"])

      expect((yield* request("GET", "/api/devices/me/preferences", { token: mine.token })).status).toBe(200)
      expect((yield* request("GET", "/api/devices/me/preferences", { token: theirs.token })).status).toBe(200)

      // A flow saved from one console is one home's only.
      const flows = (yield* first.console({ method: "GET", path: "/console-api/flows" })).json as Array<{ id: string; enabled: boolean }>
      const flow = flows[0]!
      expect((yield* first.console({ method: "PUT", path: `/console-api/flows/${flow.id}`, body: JSON.stringify({ ...flow, enabled: !flow.enabled }) })).status).toBe(200)
      const enabled = (home: FakeHome) =>
        Effect.map(request("GET", "/api/flows", { token: home === first ? mine.token : theirs.token }), (response) =>
          (response.json as Array<{ id: string; enabled: boolean }>).find((listedFlow) => listedFlow.id === flow.id)?.enabled)
      expect(yield* enabled(first)).toBe(!flow.enabled)
      expect(yield* enabled(second)).toBe(flow.enabled)
    }).pipe(Effect.provide(Cloud)))

  it.effect("a token is checked against its own home: removed is 401, its home gone is 503", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      const other = yield* makeFakeHome({ privateKey: otherKey() })
      yield* linked(home)
      yield* linked(other)
      const iphone = yield* pair(home, "iPhone")
      // A token of a home that holds no such iPhone, even if another home does.
      const forged = `${other.homeId}.${iphone.token.split(".")[1]}`
      expect(yield* request("GET", "/api/flows", { token: forged })).toEqual({ status: 401, json: { _tag: "Unauthorized" } })
      expect((yield* home.console({ method: "DELETE", path: `/console-api/devices/${iphone.deviceId}` })).status).toBe(204)
      expect(yield* request("GET", "/api/flows", { token: iphone.token })).toEqual({ status: 401, json: { _tag: "Unauthorized" } })
      yield* home.disconnect
      expect((yield* request("GET", "/api/flows", { token: iphone.token })).json).toMatchObject({ _tag: "HomeOffline" })
      expect((yield* request("GET", "/api/flows", { token: `${"a".repeat(32)}.${"b".repeat(43)}` })).status).toBe(503)
    }).pipe(Effect.provide(Cloud)))

  it.effect("an iPhone paired before several homes (a token without home id) still finds its home", () =>
    Effect.gen(function*() {
      const legacy = "x".repeat(43)
      const home = yield* makeFakeHome({ privateKey: otherKey() })
      home.documents.set("devices/old", {
        id: "old",
        name: "Old iPhone",
        tokenHash: createHash("sha256").update(legacy).digest("hex"),
        apnsEnvironment: "production",
        pushToStartToken: null,
        pairedAt: 0,
        lastSeenAt: null,
        preferences: { flows: {} },
        activityTokens: {},
        dismissed: {}
      })
      yield* linked(yield* makeFakeHome())
      yield* linked(home)
      expect((yield* request("GET", "/api/flows", { token: legacy })).status).toBe(200)
      // Unknown to every home linked: it may be a home's that is away.
      expect((yield* request("GET", "/api/flows", { token: "y".repeat(43) })).status).toBe(503)
    }).pipe(Effect.provide(Cloud)))

  it.effect("a code no home holds is refused as unknown, or offline while no home is linked; health needs no home", () =>
    Effect.gen(function*() {
      const body = { code: "ABCDEFGH", name: "iPhone", apnsEnvironment: "production" }
      expect((yield* request("POST", "/api/devices", { body })).json).toMatchObject({ _tag: "HomeOffline" })
      expect((yield* request("GET", "/api/health")).status).toBe(200)
      expect((yield* request("GET", "/console-api/devices")).status).toBe(404)
      yield* linked(yield* makeFakeHome())
      expect(yield* request("POST", "/api/devices", { body })).toMatchObject({ status: 403, json: { _tag: "InvalidPairingCode" } })
      expect((yield* request("GET", "/console-api/devices")).status).toBe(404)
    }).pipe(Effect.provide(Cloud)))

  it.effect("a home gone for an hour is forgotten; linking again starts it afresh", () =>
    Effect.gen(function*() {
      const homes = yield* Homes
      const home = yield* makeFakeHome()
      yield* linked(home)
      const iphone = yield* pair(home, "iPhone")
      yield* home.disconnect
      yield* TestClock.adjust(Timing.forgetAfterMs - Timing.sweepMs)
      yield* settle
      expect(yield* homes.homeIds).toEqual([home.homeId])
      yield* TestClock.adjust(2 * Timing.sweepMs)
      yield* settle
      expect(yield* homes.homeIds).toEqual([])
      expect((yield* request("GET", "/api/flows", { token: iphone.token })).status).toBe(503)
      yield* linked(home)
      expect(yield* homes.homeIds).toEqual([home.homeId])
      expect((yield* request("GET", "/api/flows", { token: iphone.token })).status).toBe(200)
    }).pipe(Effect.provide(Cloud)))
})
