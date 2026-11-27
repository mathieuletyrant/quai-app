import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import type { HomeProtocol } from "@quai/api"
import { type ConsoleRequest, HomeLink } from "@quai/domain/home/HomeLink.ts"
import { Effect, FileSystem, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { CloudSeen } from "../src/CloudSeen.ts"
import { ConsoleAuth, sessionMs, sessionToken, validToken } from "../src/ConsoleAuth.ts"
import { ConsoleRelayLive, HomeApiLive, OpenApiLive, openApiPath } from "../src/ConsoleServer.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { Link } from "../src/Link.ts"
import { LocalHome, startingMessage } from "../src/LocalHome.ts"
import { ServiceAuth } from "../src/ServiceAuth.ts"
import { verdict } from "../src/ServiceCheck.ts"
import { merged, ServiceSettings } from "../src/ServiceSettings.ts"
import { configLayer, NodeFileSystem, tempDir } from "./config.ts"
import { fakeHttp } from "./fakeHttp.ts"

const secret = Buffer.from("home secret")
const homeKey = Layer.succeed(HomeKey, {
  publicKey: "pk",
  homeId: "0123456789abcdef0123456789abcdef",
  sign: () => "sig",
  webhookToken: "w",
  consoleSecret: secret
})

/** The console routes on an in-memory server: Radarr and Sonarr left to the Services page. */
const consoleServer = (options: {
  readonly password?: string
  /** What the domain's routes answer the console; without it, they aren't up yet. */
  readonly domain?: (request: ConsoleRequest) => { status: number; body: string }
  /** What Quai Cloud said when it welcomed this home; without it, the link is down. */
  readonly welcomed?: HomeProtocol.Welcome
}) => {
  const relayed: Array<ConsoleRequest> = []
  const config = configLayer({
    radarr: null,
    sonarr: null,
    reclaimerr: null,
    suggestedUrls: { sonarr: "http://sonarr_server_1:8989" },
    password: options.password === undefined ? null : Redacted.make(options.password)
  })
  const link = Layer.mergeAll(
    Layer.succeed(Link, {
      linked: Effect.succeed(options.welcomed !== undefined),
      welcome: () => options.welcomed ?? null,
      push: () => Effect.die(new Error("not in this test")),
      answerApp: () => Effect.void
    }),
    Layer.succeed(LocalHome, {
      link: HomeLink.offline,
      webhook: () => Effect.void,
      pairingHashes: Effect.succeed([]),
      pairingChanged: Effect.never,
      console: (request) =>
        Effect.sync(() => {
          relayed.push(request)
          return options.domain?.(request) ??
            { status: 503, body: JSON.stringify({ _tag: "HomeOffline", message: startingMessage }) }
        })
    })
  )
  const radarr = fakeHttp((incoming) => {
    // Reclaimerr: a bearer token with the events:read and tasks:read scopes ("scoped"), only
    // events:read ("events"), or neither ("unscoped").
    if (incoming.url.pathname.startsWith("/api/v1/")) {
      const token = incoming.headers["authorization"]
      if (!["Bearer scoped", "Bearer events", "Bearer unscoped"].includes(token ?? "")) return { status: 401, json: {} }
      if (incoming.url.pathname === "/api/v1/events") {
        return token === "Bearer unscoped" ? { status: 403, json: {} } : { json: { items: [] } }
      }
      if (incoming.url.pathname.startsWith("/api/v1/tasks/")) {
        return token === "Bearer scoped" ? { json: { enabled: true } } : { status: 403, json: {} }
      }
      return { json: { status: "ok", version: "0.6.17" } }
    }
    return incoming.headers["x-api-key"] === "good"
      ? { json: { appName: "Radarr", version: "6.0.4.10291" } }
      : { status: 401, json: {} }
  })
  const files = Layer.mergeAll(
    Layer.effect(ServiceSettings, Effect.flatMap(tempDir, (dir) => ServiceSettings.make(join(dir, "services.json")))),
    Layer.effect(
      CloudSeen,
      Effect.flatMap(tempDir, (dir) => CloudSeen.make(join(dir, "cloud.json"), "ws://cloud:8787/home"))
    )
  ).pipe(Layer.provide(NodeFileSystem.layer))
  const layer = HttpRouter.serve(Layer.mergeAll(HomeApiLive, OpenApiLive, ConsoleRelayLive)).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provide(ServiceAuth.layer.pipe(Layer.provide(radarr))),
    Layer.provideMerge(ConsoleAuth.layer),
    Layer.provideMerge(files),
    Layer.provide([link, homeKey]),
    Layer.provideMerge(config)
  )
  return { layer, relayed }
}

const request = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; cookie?: string } = {}
) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    let outgoing = HttpClientRequest.make(method)(path)
    if (options.body !== undefined) outgoing = HttpClientRequest.bodyJsonUnsafe(outgoing, options.body)
    if (options.cookie !== undefined) outgoing = HttpClientRequest.setHeader(outgoing, "Cookie", options.cookie)
    const response = yield* client.execute(outgoing)
    const text = yield* response.text
    return {
      status: response.status,
      json: text === "" ? undefined : JSON.parse(text),
      setCookie: response.headers["set-cookie"]
    }
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
  it.effect("has the domain's routes answer /console-api and /api/health, signed in only", () => {
    const { layer, relayed } = consoleServer({
      password: "pw",
      domain: (asked) =>
        asked.method === "DELETE"
          ? { status: 204, body: "" }
          : { status: 200, body: JSON.stringify({ path: asked.path }) }
    })
    return Effect.gen(function*() {
      expect((yield* request("GET", "/console-api/devices")).status).toBe(401)
      expect(relayed).toEqual([])
      const cookie = yield* signIn("pw")
      expect((yield* request("GET", "/console-api/journal?limit=5", { cookie })).json).toEqual({
        path: "/console-api/journal?limit=5"
      })
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

  it.effect("answers what the console reads as offline until the domain's routes are up; no other path, no other method", () => {
    const { layer, relayed } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      expect(yield* request("GET", "/console-api/devices", { cookie })).toMatchObject({
        status: 503,
        json: { _tag: "HomeOffline", message: startingMessage }
      })
      expect((yield* request("GET", "/console-api/../api/library", { cookie })).status).toBe(404)
      expect(relayed).toEqual([{ method: "GET", path: "/console-api/devices" }])
    }).pipe(Effect.provide(layer))
  })
})

describe("where the home stands", () => {
  it.effect("says the link to Quai Cloud is down, and no version of a Cloud that never welcomed it", () => {
    const { layer } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const overview = yield* request("GET", "/home-api/home", { cookie })
      expect(overview.json.cloud).toEqual({ configured: true, linked: false, url: "http://cloud" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("says the Cloud's version once it welcomed this home, as the Cloud said it", () => {
    const { layer } = consoleServer({ password: "pw", welcomed: { _tag: "Welcome", homeId: "h", version: "2.5.0" } })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const overview = yield* request("GET", "/home-api/home", { cookie })
      expect(overview.json.cloud).toEqual({ configured: true, linked: true, version: "2.5.0", url: "http://cloud" })
    }).pipe(Effect.provide(layer))
  })

  it.effect("an older Cloud says no version: linked all the same", () => {
    const { layer } = consoleServer({ password: "pw", welcomed: { _tag: "Welcome", homeId: "h" } })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const overview = yield* request("GET", "/home-api/home", { cookie })
      expect(overview.json.cloud).toEqual({ configured: true, linked: true, url: "http://cloud" })
    }).pipe(Effect.provide(layer))
  })
})

describe("what Quai Home answers, as OpenAPI", () => {
  it.effect("is read by whoever is signed in to the console, and nobody else", () => {
    const { layer, relayed } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      expect(yield* request("GET", openApiPath)).toMatchObject({ status: 401, json: { _tag: "Unauthorized" } })
      const cookie = yield* signIn("pw")
      const answer = yield* request("GET", openApiPath, { cookie })
      expect(answer.status).toBe(200)
      expect(answer.json).toMatchObject({ openapi: "3.1.0", info: { title: "Quai Home", version: "dev" } })
      expect(Object.keys(answer.json.paths)).toEqual(
        expect.arrayContaining(["/health", "/webhooks/{service}", "/home-api/services", "/api/library"])
      )
      // Quai Home's own: the domain's routes aren't asked for it.
      expect(relayed).toEqual([])
      yield* TestClock.adjust(sessionMs)
      expect((yield* request("GET", openApiPath, { cookie })).status).toBe(401)
    }).pipe(Effect.provide(layer))
  })
})

describe("services page", () => {
  it("checks what it saves, and keeps the saved key when none is sent", () => {
    expect(merged("radarr", { url: "radarr:7878", secret: "k" }, undefined)).toMatchObject({ _tag: "InvalidService" })
    expect(merged("radarr", { url: "http://radarr:7878" }, undefined)).toMatchObject({ _tag: "InvalidService" })
    expect(merged("radarr", { url: "http://radarr:7878/", secret: "k" }, undefined)).toEqual({
      url: "http://radarr:7878",
      secret: "k"
    })
    expect(merged("radarr", { url: "http://radarr2:7878", secret: "" }, { url: "http://radarr:7878", secret: "k" }))
      .toEqual({ url: "http://radarr2:7878", secret: "k" })
    expect(merged("qbittorrent", { url: "http://qb:8080", username: " admin " }, undefined)).toEqual({
      url: "http://qb:8080",
      username: "admin"
    })
    expect(merged("radarr", { url: "http://radarr:7878", secret: "k", username: "ignored" }, undefined)).toEqual({
      url: "http://radarr:7878",
      secret: "k"
    })
  })

  it.effect("Reclaimerr's key without events:read or tasks:read passes its check, which says what each leaves out", () => {
    const { layer } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const unscoped = yield* request("PUT", "/home-api/services/reclaimerr", {
        cookie,
        body: { url: "http://reclaimerr:8000", secret: "unscoped" }
      })
      expect(unscoped.json.check).toEqual({
        outcome: "ok",
        message: "Reclaimerr 0.6.17 · the key lacks events:read: nothing it deletes is said to be gone · " +
          "the key lacks tasks:read: when it deletes is only the earliest",
        version: "0.6.17"
      })
      const events = yield* request("PUT", "/home-api/services/reclaimerr", {
        cookie,
        body: { url: "http://reclaimerr:8000", secret: "events" }
      })
      expect(events.json.check.message).toBe(
        "Reclaimerr 0.6.17 · the key lacks tasks:read: when it deletes is only the earliest"
      )
      const scoped = yield* request("PUT", "/home-api/services/reclaimerr", {
        cookie,
        body: { url: "http://reclaimerr:8000", secret: "scoped" }
      })
      expect(scoped.json.check).toEqual({ outcome: "ok", message: "Reclaimerr 0.6.17", version: "0.6.17" })
      const refused = yield* request("PUT", "/home-api/services/reclaimerr", {
        cookie,
        body: { url: "http://reclaimerr:8000", secret: "wrong" }
      })
      expect(refused.json.check.outcome).toBe("refused")
    }).pipe(Effect.provide(layer))
  })

  it("reads what a check got back", () => {
    expect(verdict("radarr", 200, JSON.stringify({ version: "6.0.4" }))).toEqual({
      outcome: "ok",
      message: "Radarr 6.0.4",
      version: "6.0.4"
    })
    expect(verdict("qbittorrent", 200, "v5.1.2")).toEqual({
      outcome: "ok",
      message: "qBittorrent 5.1.2",
      version: "5.1.2"
    })
    expect(verdict("seerr", 200, "{}")).toEqual({ outcome: "ok", message: "Seerr reached" })
    expect(verdict("sonarr", 401, "")).toMatchObject({ outcome: "refused" })
    expect(verdict("sonarr", 500, "")).toMatchObject({ outcome: "failed" })
  })

  it.effect("saves a service in /data (never showing its key), checks it, and removes it; the environment's can't be changed", () => {
    const { layer } = consoleServer({ password: "pw" })
    return Effect.gen(function*() {
      const cookie = yield* signIn("pw")
      const wrong = yield* request("PUT", "/home-api/services/radarr", {
        cookie,
        body: { url: "http://radarr:7878", secret: "bad" }
      })
      expect(wrong.json.check.outcome).toBe("refused")
      const saved = yield* request("PUT", "/home-api/services/radarr", {
        cookie,
        body: { url: "http://radarr:7878", secret: "good" }
      })
      expect(saved.json).toEqual({
        setup: { service: "radarr", source: "saved", url: "http://radarr:7878", hasSecret: true },
        check: { outcome: "ok", message: "Radarr 6.0.4.10291", version: "6.0.4.10291" }
      })
      // A new address alone keeps the key.
      yield* request("PUT", "/home-api/services/radarr", { cookie, body: { url: "http://radarr:7878" } })
      expect((yield* request("POST", "/home-api/services/radarr/check", { cookie })).json.outcome).toBe("ok")

      const list = (yield* request("GET", "/home-api/services", { cookie })).json as ReadonlyArray<
        { service: string; source: string }
      >
      expect(JSON.stringify(list)).not.toContain("good")
      expect(list.find((setup) => setup.service === "radarr")?.source).toBe("saved")
      expect(list.find((setup) => setup.service === "sonarr")).toEqual({
        service: "sonarr",
        source: "none",
        hasSecret: false,
        suggestedUrl: "http://sonarr_server_1:8989"
      })
      expect(list.find((setup) => setup.service === "jellyfin")?.source).toBe("environment")

      expect(
        (yield* request("PUT", "/home-api/services/jellyfin", { cookie, body: { url: "http://j:8096", secret: "k" } }))
          .status
      ).toBe(409)
      expect((yield* request("DELETE", "/home-api/services/jellyfin", { cookie })).status).toBe(409)
      expect(
        (yield* request("PUT", "/home-api/services/sonarr", { cookie, body: { url: "http://sonarr:8989" } })).status
      ).toBe(400)

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
