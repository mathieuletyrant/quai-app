import { describe, expect, it } from "@effect/vitest"
import type { CallRequest } from "@quai/domain/home/HomeLink.ts"
import { Effect, Fiber, Layer } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Calls, maxBodyBytes } from "../src/Calls.ts"
import { ServiceAuth, sessionCookie } from "../src/ServiceAuth.ts"
import { configLayer, journalLayer } from "./config.ts"
import { fakeHttp, type Seen } from "./fakeHttp.ts"

type Route = Parameters<typeof fakeHttp>[0]

const callsWith = (route: Route, seen: Array<Seen>, config = configLayer()) =>
  Calls.layer.pipe(
    Layer.provide(ServiceAuth.fromConfig),
    Layer.provideMerge(journalLayer),
    Layer.provide([config, fakeHttp(route, seen)])
  )

const request = (call: CallRequest): CallRequest => call

describe("calls", () => {
  it.effect("a service that isn't configured is a failure", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(
        request({ service: "sonarr", method: "GET", path: "/api/v3/system/status" })
      )
      expect(result).toEqual({ _tag: "Failed", reason: "sonarr is not configured" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen, configLayer({ sonarr: null }))))
  })

  it.effect("adds each service's credentials and returns the status and body", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const radarr = yield* calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(radarr).toEqual({ _tag: "Answered", status: 200, body: "{\"version\":\"5.0\"}" })
      expect(seen[0]!.url.href).toBe("http://radarr:7878/api/v3/system/status")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")

      yield* calls.run(request({ service: "jellyfin", method: "GET", path: "/Items?Recursive=true&SearchTerm=Dune" }))
      expect(seen[1]!.url.host).toBe("jellyfin:8096")
      expect(seen[1]!.url.pathname).toBe("/Items")
      expect(seen[1]!.url.searchParams.get("SearchTerm")).toBe("Dune")
      expect(seen[1]!.headers["authorization"]).toBe("MediaBrowser Token=\"masked\"")
      expect(seen[1]!.headers["x-api-key"]).toBeUndefined()

      yield* calls.run(
        request({ service: "jellyfin", method: "POST", path: "/Sessions/s-1/Playing/PlayPause", body: { a: 1 } })
      )
      expect(seen[2]!.method).toBe("POST")
      expect(JSON.parse(seen[2]!.body!)).toEqual({ a: 1 })
    }).pipe(Effect.provide(callsWith(() => ({ json: { version: "5.0" } }), seen)))
  })

  it.effect("runs the library reads with the service's key", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      for (
        const [service, path] of [["radarr", "/api/v3/movie"], ["radarr", "/api/v3/diskspace"], [
          "sonarr",
          "/api/v3/series"
        ]] as const
      ) {
        expect(yield* calls.run(request({ service, method: "GET", path }))).toMatchObject({
          _tag: "Answered",
          status: 200
        })
      }
      expect(seen.map((recorded) => `${recorded.method} ${recorded.url.host}${recorded.url.pathname}`)).toEqual([
        "GET radarr:7878/api/v3/movie",
        "GET radarr:7878/api/v3/diskspace",
        "GET sonarr:8989/api/v3/series"
      ])
      expect(seen.every((recorded) => recorded.headers["x-api-key"] === "masked")).toBe(true)
    }).pipe(Effect.provide(callsWith(() => ({ json: [] }), seen)))
  })

  it.effect("a service that doesn't answer is a failure, not an error", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(
        request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })
      )
      expect(result).toEqual({ _tag: "Failed", reason: "unreachable" })
    }).pipe(Effect.provide(callsWith(() => ({ unreachable: true }), []))))
})

describe("To fix calls", () => {
  it.effect("removes a queue item with DELETE, and protects in Reclaimerr with its bearer token", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const removed = yield* calls.run(
        request({ service: "radarr", method: "DELETE", path: "/api/v3/queue/41?removeFromClient=true&blocklist=true" })
      )
      expect(removed).toMatchObject({ _tag: "Answered", status: 200 })
      expect(seen[0]!.method).toBe("DELETE")
      expect(seen[0]!.url.href).toBe("http://radarr:7878/api/v3/queue/41?removeFromClient=true&blocklist=true")

      yield* calls.run(
        request({
          service: "reclaimerr",
          method: "POST",
          path: "/api/v1/candidates/42/protect",
          body: { reason: "Kept from Quai" }
        })
      )
      expect(seen[1]!.url.href).toBe("http://reclaimerr:8000/api/v1/candidates/42/protect")
      expect(seen[1]!.headers["authorization"]).toBe("Bearer masked")
      expect(seen[1]!.headers["x-api-key"]).toBeUndefined()
      expect(JSON.parse(seen[1]!.body!)).toEqual({ reason: "Kept from Quai" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })

  it.effect("approves and creates a Seerr request with its API key", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const approved = yield* calls.run(
        request({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve" })
      )
      expect(approved).toMatchObject({ _tag: "Answered", status: 200 })
      expect(seen[0]!.url.href).toBe("http://seerr:5055/api/v1/request/12/approve")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      expect(seen[0]!.body).toBeNull()
      const created = yield* calls.run(
        request({ service: "seerr", method: "POST", path: "/api/v1/request", body: { mediaType: "movie", mediaId: 1 } })
      )
      expect(created).toMatchObject({ _tag: "Answered", status: 200 })
      expect(JSON.parse(seen[1]!.body!)).toEqual({ mediaType: "movie", mediaId: 1 })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })

  it.effect("a call given a longer wait (a release search) may take it; a read takes 10 s", () =>
    Effect.gen(function*() {
      const calls = yield* Calls
      const search = yield* Effect.forkChild(
        calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/release?movieId=12" }), {
          timeoutMs: 50_000
        })
      )
      const read = yield* Effect.forkChild(
        calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/queue" }))
      )
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(read)).toEqual({ _tag: "Failed", reason: "timed out" })
      yield* TestClock.adjust("39 seconds")
      expect(search.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(search)).toEqual({ _tag: "Failed", reason: "timed out" })
    }).pipe(Effect.provide(Calls.layer.pipe(
      Layer.provide(ServiceAuth.fromConfig),
      Layer.provide([
        configLayer(),
        journalLayer,
        Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.never))
      ])
    ))))

  it.effect("Reclaimerr unset is not configured", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(
        request({ service: "reclaimerr", method: "GET", path: "/api/v1/candidates" })
      )
      expect(result).toEqual({ _tag: "Failed", reason: "reclaimerr is not configured" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), [], configLayer({ reclaimerr: null })))))
})

describe("Cleanuparr calls", () => {
  const hash = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
  const settings = {
    enabled: true,
    cronExpression: "0 0/5 * * * ?",
    useAdvancedScheduling: false,
    failedImport: {
      maxStrikes: 3,
      ignorePrivate: false,
      deletePrivate: false,
      skipIfNotFoundInClient: true,
      patterns: [],
      patternMode: "Exclude",
      changeCategory: false,
      forceImport: false,
      forceImportMaxTries: 3
    },
    ignoredDownloads: [] as Array<string>,
    processNoContentId: false,
    downloadingMetadataMaxStrikes: 3,
    errored: { maxStrikes: 0, ignorePrivate: false, deletePrivate: false, changeCategory: false }
  }
  const exclude = (body: unknown) =>
    request({ service: "cleanuparr", method: "PUT", path: "/api/configuration/queue_cleaner", body })
  const holding = (current: unknown) => (recorded: Seen) =>
    recorded.method === "GET"
      ? { json: current }
      : { json: { message: "QueueCleaner configuration updated successfully" } }

  it.effect("reads with its API key", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(
        request({ service: "cleanuparr", method: "GET", path: "/api/strikes?page=1&pageSize=500" })
      )
      expect(result).toMatchObject({ _tag: "Answered", status: 200 })
      expect(seen[0]!.url.href).toBe("http://cleanuparr:11011/api/strikes?page=1&pageSize=500")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
    }).pipe(Effect.provide(callsWith(() => ({ json: { items: [] } }), seen)))
  })

  it.effect("writes its queue cleaner's settings with its API key, as they are given", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(exclude({ ...settings, ignoredDownloads: [hash] }))
      expect(result).toMatchObject({ _tag: "Answered", status: 200 })
      expect(seen.map((recorded) => `${recorded.method} ${recorded.url.pathname}`)).toEqual([
        "PUT /api/configuration/queue_cleaner"
      ])
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      expect(JSON.parse(seen[0]!.body!).ignoredDownloads).toEqual([hash])
    }).pipe(Effect.provide(callsWith(holding(settings), seen)))
  })
})

describe("call bodies", () => {
  it.effect("a response over maxBodyBytes is a failure", () =>
    Effect.gen(function*() {
      const calls = yield* Calls
      const status = request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })
      expect(yield* calls.run(status)).toEqual({ _tag: "Failed", reason: "too large" })
    }).pipe(Effect.provide(callsWith(() => ({ text: "x".repeat(maxBodyBytes + 1) }), []))))

  it.effect("a body of exactly maxBodyBytes goes through", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(
        request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })
      )
      expect(result).toMatchObject({ _tag: "Answered", status: 200 })
    }).pipe(Effect.provide(callsWith(() => ({ text: "x".repeat(maxBodyBytes) }), []))))
})

describe("call timeout", () => {
  it.effect("a call that hangs fails after 10 s", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        (yield* Calls).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      )
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Failed", reason: "timed out" })
    }).pipe(Effect.provide(Calls.layer.pipe(
      Layer.provide(ServiceAuth.fromConfig),
      Layer.provide([
        configLayer(),
        journalLayer,
        Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.never))
      ])
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
    const route: Route = (incoming) => {
      if (incoming.url.pathname === "/api/v2/auth/login") {
        loggedIn = true
        return { status: 200, headers: { "set-cookie": "QBT_SID_8080=s3ss10n; HttpOnly; path=/" } }
      }
      return loggedIn && incoming.headers["cookie"] === "QBT_SID_8080=s3ss10n" ? { json: [] } : { status: 403 }
    }
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(info)
      expect(result).toEqual({ _tag: "Answered", status: 200, body: "[]" })
      expect(seen.map((recorded) => recorded.url.pathname)).toEqual([
        "/api/v2/torrents/info",
        "/api/v2/auth/login",
        "/api/v2/torrents/info"
      ])
      expect(seen[1]!.body).toBe("username=admin&password=pw")
      expect(seen[2]!.url.searchParams.get("hashes")).toBe("a|b")
    }).pipe(Effect.provide(callsWith(route, seen)))
  })

  it.effect("calls that get a 403 together log in once, and all use the new cookie", () => {
    const seen: Array<Seen> = []
    const route: Route = (incoming) => {
      if (incoming.url.pathname === "/api/v2/auth/login") {
        return { delay: "1 second", headers: { "set-cookie": "QBT_SID_8080=s3ss10n; HttpOnly; path=/" } }
      }
      return incoming.headers["cookie"] === "QBT_SID_8080=s3ss10n" ? { json: [] } : { status: 403 }
    }
    return Effect.gen(function*() {
      const calls = yield* Calls
      const both = yield* Effect.forkChild(Effect.all([calls.run(info), calls.run(info)], { concurrency: "unbounded" }))
      yield* TestClock.adjust("1 second")
      const results = yield* Fiber.join(both)
      expect(results.map((result) => result._tag)).toEqual(["Answered", "Answered"])
      expect(seen.filter((recorded) => recorded.url.pathname === "/api/v2/auth/login")).toHaveLength(1)
    }).pipe(Effect.provide(callsWith(route, seen)))
  })

  it.effect("a wrong password is reported, and never tried again", () => {
    const seen: Array<Seen> = []
    const route: Route = (incoming) =>
      incoming.url.pathname === "/api/v2/auth/login" ? { text: "Fails." } : { status: 403 }
    return Effect.gen(function*() {
      const calls = yield* Calls
      const logins = () => seen.filter((recorded) => recorded.url.pathname === "/api/v2/auth/login").length
      expect(yield* calls.run(info)).toEqual({ _tag: "Failed", reason: "wrong username or password" })
      yield* TestClock.adjust("1 hour")
      expect(yield* calls.run(info)).toEqual({ _tag: "Failed", reason: "wrong username or password" })
      expect(logins()).toBe(1)
    }).pipe(Effect.provide(callsWith(route, seen)))
  })
})
