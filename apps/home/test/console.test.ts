import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { CloudSeen } from "../src/CloudSeen.ts"
import { ConsoleAuth, sessionMs, sessionToken, validToken } from "../src/ConsoleAuth.ts"
import { ConsoleRelayLive, HomeApiLive } from "../src/ConsoleServer.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { Link, type ConsoleRequest } from "../src/Link.ts"
import { ServiceAuth } from "../src/ServiceAuth.ts"
import { verdict } from "../src/ServiceCheck.ts"
import { merged, ServiceSettings } from "../src/ServiceSettings.ts"
import { CloudUnreachable } from "../src/Errors.ts"
import { configLayer, NodeFileSystem, tempDir } from "./config.ts"
import { fakeHttp } from "./fakeHttp.ts"

const secret = Buffer.from("home secret")
const homeKey = Layer.succeed(HomeKey, { publicKey: "pk", homeId: "0123456789abcdef0123456789abcdef", sign: () => "sig", webhookToken: "w", consoleSecret: secret })

/** The console routes on an in-memory server: Radarr and Sonarr left to the Services page. */
const consoleServer = (options: {
  readonly password?: string
  readonly cloud?: (request: ConsoleRequest) => Effect.Effect<{ status: number; body: string }, CloudUnreachable>
}) => {
  const relayed: Array<ConsoleRequest> = []
  const config = configLayer({
    radarr: null,
    sonarr: null,
    password: options.password === undefined ? null : Redacted.make(options.password)
  })
  const link = Layer.succeed(Link, {
    send: () => Effect.void,
    linked: Effect.succeed(options.cloud !== undefined),
    console: (request) =>
      Effect.andThen(
        Effect.sync(() => relayed.push(request)),
        options.cloud?.(request) ?? Effect.fail(new CloudUnreachable({ message: "No Quai Cloud is set: set QUAI_CLOUD_URL on Quai Home" }))
      )
  })
  const radarr = fakeHttp((r) =>
    r.headers["x-api-key"] === "good" ? { json: { appName: "Radarr", version: "6.0.4.10291" } } : { status: 401, json: {} })
  const files = Layer.mergeAll(
    Layer.effect(ServiceSettings, Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json")))),
    Layer.effect(CloudSeen, Effect.flatMap(tempDir, (dir) => CloudSeen.make(join(dir, "cloud.json"), "ws://cloud:8787/home")))
  ).pipe(Layer.provide(NodeFileSystem.layer))
  const layer = HttpRouter.serve(Layer.mergeAll(HomeApiLive, ConsoleRelayLive)).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provide(ServiceAuth.layer.pipe(Layer.provide(radarr))),
    Layer.provideMerge(ConsoleAuth.layer),
    Layer.provideMerge(files),
    Layer.provide([link, homeKey]),
    Layer.provideMerge(config)
  )
  return { layer, relayed }
}

const request = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, options: { body?: unknown; cookie?: string } = {}) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    let r = HttpClientRequest.make(method)(path)
    if (options.body !== undefined) r = HttpClientRequest.bodyJsonUnsafe(r, options.body)
    if (options.cookie !== undefined) r = HttpClientRequest.setHeader(r, "Cookie", options.cookie)
    const response = yield* client.execute(r)
    const text = yield* response.text
    return { status: response.status, json: text === "" ? undefined : JSON.parse(text), setCookie: response.headers["set-cookie"] }
  })

/** Signs in and returns the session cookie, `quai_session=…`. */
const signIn = (password: string) =>
  Effect.gen(function*() {
    const response = yield* request("POST", "/home-api/session", { body: { password } })
    expect(response.status).toBe(204)
    const header = String(response.setCookie)
    expect(header).toContain("HttpOnly")
    expect(header).not.toContain("Secure")
    return header.split(";")[0]!
  })

describe("console session", () => {
  it("a token is valid until it expires, and only for the password it was made with", () => {
    const token = sessionToken(secret, "pw", 1000)
    expect(validToken(secret, "pw", token, 999)).toBe(true)
    expect(validToken(secret, "pw", token, 1000)).toBe(false)
    expect(validToken(secret, "other", token, 0)).toBe(false)
    expect(validToken(Buffer.from("another home"), "pw", token, 0)).toBe(false)
    expect(validToken(secret, "pw", "2000.forged", 0)).toBe(false)
    expect(validToken(secret, "pw", "garbage", 0)).toBe(false)
  })

  it.effect("without QUAI_HOME_PASSWORD the console is locked: nothing to sign in with", () => {
    const { layer } = consoleServer({})
    return Effect.gen(function*() {
      expect((yield* request("GET", "/home-api/session")).json).toEqual({ state: "locked" })
      expect((yield* request("POST", "/home-api/session", { body: { password: "" } })).status).toBe(401)
      expect((yield* request("GET", "/home-api/services")).status).toBe(401)
    }).pipe(Effect.provide(layer))
  })

  it.effect("signs in with the password, for 30 days; a wrong one is refused", () => {
    const { layer } = consoleServer({ password: "hunter2" })
    return Effect.gen(function*() {
      expect((yield* request("GET", "/home-api/session")).json).toEqual({ state: "signedOut" })
      expect((yield* request("POST", "/home-api/session", { body: { password: "nope" } })).status).toBe(401)
      const cookie = yield* signIn("hunter2")
      expect((yield* request("GET", "/home-api/session", { cookie })).json).toEqual({ state: "signedIn" })
      expect((yield* request("GET", "/home-api/home", { cookie })).status).toBe(200)
      yield* TestClock.adjust(sessionMs)
      expect((yield* request("GET", "/home-api/session", { cookie })).json).toEqual({ state: "signedOut" })
      expect((yield* request("GET", "/home-api/home", { cookie })).status).toBe(401)
    }).pipe(Effect.provide(layer))
  })
})

describe("console relay", () => {
  it.effect("relays /console-api and /api/health to the Cloud, signed in only", () => {
    const { layer, relayed } = consoleServer({
      password: "pw",
      cloud: (r) => Effect.succeed(r.method === "DELETE" ? { status: 204, body: "" } : { status: 200, body: JSON.stringify({ path: r.path }) })
    })
    return Effect.gen(function*() {
      expect((yield* request("GET", "/console-api/devices")).status).toBe(401)
      expect(relayed).toEqual([])
      const cookie = yield* signIn("pw")
      expect((yield* request("GET", "/console-api/journal?limit=5", { cookie })).json).toEqual({ path: "/console-api/journal?limit=5" })
      expect((yield* request("GET", "/api/health", { cookie })).status).toBe(200)
      expect((yield* request("PUT", "/console-api/alerts", { cookie, body: { on: true } })).status).toBe(200)
      expect((yield* request("DELETE", "/console-api/devices/a", { cookie })).status).toBe(204)
      expect(relayed).toEqual([
        { method: "GET", path: "/console-api/journal?limit=5" },
        { method: "GET", path: "/api/health" },
        { method: "PUT", path: "/console-api/alerts", body: JSON.stringify({ on: true }) },
        { method: "DELETE", path: "/console-api/devices/a" }
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect("without a Cloud, answers what the console reads as offline, with what to set", () => {
    const { layer } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      expect(yield* request("GET", "/console-api/devices", { cookie })).toMatchObject({
        status: 503,
        json: { _tag: "HomeOffline", message: "No Quai Cloud is set: set QUAI_CLOUD_URL on Quai Home" }
      })
    }).pipe(Effect.provide(layer))
  })
})

describe("services page", () => {
  it("checks what it saves, and keeps the saved key when none is sent", () => {
    expect(merged("radarr", { url: "radarr:7878", secret: "k" }, undefined)).toMatchObject({ _tag: "InvalidService" })
    expect(merged("radarr", { url: "http://radarr:7878" }, undefined)).toMatchObject({ _tag: "InvalidService" })
    expect(merged("radarr", { url: "http://radarr:7878/", secret: "k" }, undefined)).toEqual({ url: "http://radarr:7878", secret: "k" })
    expect(merged("radarr", { url: "http://radarr2:7878", secret: "" }, { url: "http://radarr:7878", secret: "k" })).toEqual({ url: "http://radarr2:7878", secret: "k" })
    expect(merged("qbittorrent", { url: "http://qb:8080", username: " admin " }, undefined)).toEqual({ url: "http://qb:8080", username: "admin" })
    expect(merged("radarr", { url: "http://radarr:7878", secret: "k", username: "ignored" }, undefined)).toEqual({ url: "http://radarr:7878", secret: "k" })
  })

  it("reads what a check got back", () => {
    expect(verdict("radarr", 200, JSON.stringify({ version: "6.0.4" }))).toEqual({ outcome: "ok", message: "Radarr 6.0.4", version: "6.0.4" })
    expect(verdict("qbittorrent", 200, "v5.1.2")).toEqual({ outcome: "ok", message: "qBittorrent 5.1.2", version: "5.1.2" })
    expect(verdict("seerr", 200, "{}")).toEqual({ outcome: "ok", message: "Seerr reached" })
    expect(verdict("sonarr", 401, "")).toMatchObject({ outcome: "refused" })
    expect(verdict("sonarr", 500, "")).toMatchObject({ outcome: "failed" })
  })

  it.effect("saves a service in /data (never showing its key), checks it, and removes it; the environment's can't be changed", () => {
    const { layer } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const wrong = yield* request("PUT", "/home-api/services/radarr", { cookie, body: { url: "http://radarr:7878", secret: "bad" } })
      expect(wrong.json.check.outcome).toBe("refused")
      const saved = yield* request("PUT", "/home-api/services/radarr", { cookie, body: { url: "http://radarr:7878", secret: "good" } })
      expect(saved.json).toEqual({
        setup: { service: "radarr", source: "saved", url: "http://radarr:7878", hasSecret: true },
        check: { outcome: "ok", message: "Radarr 6.0.4.10291", version: "6.0.4.10291" }
      })
      // A new address alone keeps the key.
      yield* request("PUT", "/home-api/services/radarr", { cookie, body: { url: "http://radarr:7878" } })
      expect((yield* request("POST", "/home-api/services/radarr/check", { cookie })).json.outcome).toBe("ok")

      const list = (yield* request("GET", "/home-api/services", { cookie })).json as ReadonlyArray<{ service: string; source: string }>
      expect(JSON.stringify(list)).not.toContain("good")
      expect(list.find((s) => s.service === "radarr")?.source).toBe("saved")
      expect(list.find((s) => s.service === "sonarr")?.source).toBe("none")
      expect(list.find((s) => s.service === "jellyfin")?.source).toBe("environment")

      expect((yield* request("PUT", "/home-api/services/jellyfin", { cookie, body: { url: "http://j:8096", secret: "k" } })).status).toBe(409)
      expect((yield* request("DELETE", "/home-api/services/jellyfin", { cookie })).status).toBe(409)
      expect((yield* request("PUT", "/home-api/services/sonarr", { cookie, body: { url: "http://sonarr:8989" } })).status).toBe(400)

      expect((yield* request("DELETE", "/home-api/services/radarr", { cookie })).status).toBe(204)
      expect((yield* (yield* ServiceSettings).current).radarr).toBeNull()
    }).pipe(Effect.provide(layer))
  })

  it.effect("what was saved is back after a restart, in a file only Quai Home's user reads", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = join(yield* tempDir, "services.json")
      const first = yield* ServiceSettings.make(path)
      yield* first.save("sonarr", { url: "http://sonarr:8989", secret: "k" })
      expect(((yield* fs.stat(path)).mode & 0o777).toString(8)).toBe("600")
      const restarted = yield* ServiceSettings.make(path)
      expect(Redacted.value((yield* restarted.current).sonarr!.apiKey)).toBe("k")
    }).pipe(Effect.provide([configLayer({ sonarr: null }), NodeFileSystem.layer])))
})

describe("cloud seen", () => {
  it.effect("remembers the first Cloud; another one is a change to acknowledge", () =>
    Effect.gen(function*() {
      const path = join(yield* tempDir, "cloud.json")
      const first = yield* CloudSeen.make(path, "ws://old:8787/home")
      yield* first.linked
      expect((yield* first.previous)._tag).toBe("None")
      const moved = yield* CloudSeen.make(path, "wss://cloud.example.com/home")
      yield* moved.linked
      expect(yield* moved.previous).toMatchObject({ value: "http://old:8787" })
      yield* moved.acknowledge
      expect((yield* moved.previous)._tag).toBe("None")
    }).pipe(Effect.provide(NodeFileSystem.layer)))
})
