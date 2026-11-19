import { describe, expect, it } from "@effect/vitest"
import type { AgentProtocol } from "@quai/api"
import { Effect, Fiber, Layer } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Proxy } from "../src/Proxy.ts"
import { ServiceAuth, sessionCookie } from "../src/ServiceAuth.ts"
import { configLayer } from "./config.ts"
import { fakeHttp, type Seen } from "./fakeHttp.ts"

type Route = Parameters<typeof fakeHttp>[0]

const proxyWith = (route: Route, seen: Array<Seen>, config = configLayer()) =>
  Proxy.layer.pipe(Layer.provide(ServiceAuth.layer), Layer.provide([config, fakeHttp(route, seen)]))

const request = (fields: Omit<AgentProtocol.ProxyRequest, "_tag" | "id">): AgentProtocol.ProxyRequest => ({
  _tag: "ProxyRequest",
  id: "r1",
  ...fields
})

describe("proxy allowlist", () => {
  it.effect("refuses what the allowlist doesn't list, without calling the service", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const proxy = yield* Proxy
      const refused = [
        request({ service: "radarr", method: "GET", path: "/api/v3/config/host" }),
        request({ service: "radarr", method: "POST", path: "/api/v3/system/status" }),
        request({ service: "radarr", method: "GET", path: "/api/v3/system/status/../../config" }),
        request({ service: "jellyfin", method: "POST", path: "/Sessions/abc/Playing/../../Users" }),
        request({ service: "qbittorrent", method: "POST", path: "/api/v2/torrents/delete" })
      ]
      for (const r of refused) {
        expect(yield* proxy.run(r)).toEqual({ _tag: "ProxyFailure", id: "r1", reason: "not allowed" })
      }
      expect(seen).toHaveLength(0)
    }).pipe(Effect.provide(proxyWith(() => ({ json: {} }), seen)))
  })

  it.effect("a service that isn't configured is a failure", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Proxy).run(request({ service: "sonarr", method: "GET", path: "/api/v3/system/status" }))
      expect(result).toEqual({ _tag: "ProxyFailure", id: "r1", reason: "sonarr is not configured" })
    }).pipe(Effect.provide(proxyWith(() => ({ json: {} }), seen, configLayer({ sonarr: null }))))
  })

  it.effect("adds each service's credentials and returns the status and body", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const proxy = yield* Proxy
      const radarr = yield* proxy.run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(radarr).toEqual({ _tag: "ProxyResponse", id: "r1", status: 200, body: "{\"version\":\"5.0\"}" })
      expect(seen[0]!.url.href).toBe("http://radarr:7878/api/v3/system/status")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")

      yield* proxy.run(request({ service: "jellyfin", method: "GET", path: "/Items?Recursive=true&SearchTerm=Dune" }))
      expect(seen[1]!.url.host).toBe("jellyfin:8096")
      expect(seen[1]!.url.pathname).toBe("/Items")
      expect(seen[1]!.url.searchParams.get("SearchTerm")).toBe("Dune")
      expect(seen[1]!.headers["authorization"]).toBe("MediaBrowser Token=\"masked\"")
      expect(seen[1]!.headers["x-api-key"]).toBeUndefined()

      yield* proxy.run(request({ service: "jellyfin", method: "POST", path: "/Sessions/s-1/Playing/PlayPause", body: { a: 1 } }))
      expect(seen[2]!.method).toBe("POST")
      expect(JSON.parse(seen[2]!.body!)).toEqual({ a: 1 })
    }).pipe(Effect.provide(proxyWith(() => ({ json: { version: "5.0" } }), seen)))
  })

  it.effect("a service that doesn't answer is a failure, not an error", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Proxy).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(result).toEqual({ _tag: "ProxyFailure", id: "r1", reason: "unreachable" })
    }).pipe(Effect.provide(proxyWith(() => ({ unreachable: true }), []))))
})

describe("proxy timeout", () => {
  it.effect("a call that hangs fails after 10 s", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild((yield* Proxy).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })))
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "ProxyFailure", id: "r1", reason: "timed out" })
    }).pipe(Effect.provide(Proxy.layer.pipe(
      Layer.provide(ServiceAuth.layer),
      Layer.provide([configLayer(), Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.never))])
    ))))
})

describe("qBittorrent session", () => {
  const info = request({ service: "qbittorrent", method: "GET", path: "/api/v2/torrents/info?hashes=a|b" })

  it("reads the session cookie of qBittorrent 4 and 5", () => {
    expect(sessionCookie("SID=abc; HttpOnly; path=/")).toEqual(["SID", "abc"])
    expect(sessionCookie(["QBT_SID_8080=xyz; HttpOnly; SameSite=Strict; path=/"])).toEqual(["QBT_SID_8080", "xyz"])
    expect(sessionCookie(undefined)).toBeNull()
  })

  it.effect("a 403 logs in, then retries with the cookie", () => {
    const seen: Array<Seen> = []
    let loggedIn = false
    const route: Route = (r) => {
      if (r.url.pathname === "/api/v2/auth/login") {
        loggedIn = true
        return { status: 200, headers: { "set-cookie": "QBT_SID_8080=s3ss10n; HttpOnly; path=/" } }
      }
      return loggedIn && r.headers["cookie"] === "QBT_SID_8080=s3ss10n" ? { json: [] } : { status: 403 }
    }
    return Effect.gen(function*() {
      const result = yield* (yield* Proxy).run(info)
      expect(result).toEqual({ _tag: "ProxyResponse", id: "r1", status: 200, body: "[]" })
      expect(seen.map((r) => r.url.pathname)).toEqual(["/api/v2/torrents/info", "/api/v2/auth/login", "/api/v2/torrents/info"])
      expect(seen[1]!.body).toBe("username=admin&password=pw")
      expect(seen[2]!.url.searchParams.get("hashes")).toBe("a|b")
    }).pipe(Effect.provide(proxyWith(route, seen)))
  })

  it.effect("a wrong password is reported, and retried at 30 s, 1 min, 2 min…", () => {
    const seen: Array<Seen> = []
    const route: Route = (r) => r.url.pathname === "/api/v2/auth/login" ? { text: "Fails." } : { status: 403 }
    return Effect.gen(function*() {
      const proxy = yield* Proxy
      const logins = () => seen.filter((r) => r.url.pathname === "/api/v2/auth/login").length
      expect(yield* proxy.run(info)).toEqual({ _tag: "ProxyFailure", id: "r1", reason: "wrong username or password" })
      const callAfter = (seconds: number) => Effect.andThen(TestClock.adjust(`${seconds} seconds`), proxy.run(info))
      yield* callAfter(15)
      expect(logins()).toBe(1)
      yield* callAfter(15)
      expect(logins()).toBe(2)
      yield* callAfter(45)
      expect(logins()).toBe(2)
      yield* callAfter(15)
      expect(logins()).toBe(3)
    }).pipe(Effect.provide(proxyWith(route, seen)))
  })
})
