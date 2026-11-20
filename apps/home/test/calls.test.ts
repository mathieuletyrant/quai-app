import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import { Effect, Fiber, Layer } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Calls } from "../src/Calls.ts"
import { Journal } from "../src/Journal.ts"
import { ServiceAuth, sessionCookie } from "../src/ServiceAuth.ts"
import { configLayer, journalLayer } from "./config.ts"
import { fakeHttp, type Seen } from "./fakeHttp.ts"

type Route = Parameters<typeof fakeHttp>[0]

const callsWith = (route: Route, seen: Array<Seen>, config = configLayer()) =>
  Calls.layer.pipe(Layer.provide(ServiceAuth.layer), Layer.provideMerge(journalLayer), Layer.provide([config, fakeHttp(route, seen)]))

const request = (fields: Omit<HomeProtocol.Call, "_tag" | "id">): HomeProtocol.Call => ({
  _tag: "Call",
  id: "r1",
  ...fields
})

describe("calls allowlist", () => {
  it.effect("refuses what the allowlist doesn't list, without calling the service", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const refused = [
        request({ service: "radarr", method: "GET", path: "/api/v3/config/host" }),
        request({ service: "radarr", method: "POST", path: "/api/v3/system/status" }),
        request({ service: "radarr", method: "GET", path: "/api/v3/system/status/../../config" }),
        request({ service: "jellyfin", method: "POST", path: "/Sessions/abc/Playing/../../Users" }),
        request({ service: "qbittorrent", method: "POST", path: "/api/v2/torrents/delete" })
      ]
      for (const r of refused) {
        expect(yield* calls.run(r)).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      }
      expect(seen).toHaveLength(0)
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })

  it.effect("a service that isn't configured is a failure", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(request({ service: "sonarr", method: "GET", path: "/api/v3/system/status" }))
      expect(result).toEqual({ _tag: "Failed", id: "r1", reason: "sonarr is not configured" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen, configLayer({ sonarr: null }))))
  })

  it.effect("adds each service's credentials and returns the status and body", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const radarr = yield* calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(radarr).toEqual({ _tag: "CallResponse", id: "r1", status: 200, body: "{\"version\":\"5.0\"}" })
      expect(seen[0]!.url.href).toBe("http://radarr:7878/api/v3/system/status")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")

      yield* calls.run(request({ service: "jellyfin", method: "GET", path: "/Items?Recursive=true&SearchTerm=Dune" }))
      expect(seen[1]!.url.host).toBe("jellyfin:8096")
      expect(seen[1]!.url.pathname).toBe("/Items")
      expect(seen[1]!.url.searchParams.get("SearchTerm")).toBe("Dune")
      expect(seen[1]!.headers["authorization"]).toBe("MediaBrowser Token=\"masked\"")
      expect(seen[1]!.headers["x-api-key"]).toBeUndefined()

      yield* calls.run(request({ service: "jellyfin", method: "POST", path: "/Sessions/s-1/Playing/PlayPause", body: { a: 1 } }))
      expect(seen[2]!.method).toBe("POST")
      expect(JSON.parse(seen[2]!.body!)).toEqual({ a: 1 })
    }).pipe(Effect.provide(callsWith(() => ({ json: { version: "5.0" } }), seen)))
  })

  it.effect("runs the library reads with the service's key", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      for (const [service, path] of [["radarr", "/api/v3/movie"], ["radarr", "/api/v3/diskspace"], ["sonarr", "/api/v3/series"]] as const) {
        expect(yield* calls.run(request({ service, method: "GET", path }))).toMatchObject({ _tag: "CallResponse", status: 200 })
      }
      expect(seen.map((s) => `${s.method} ${s.url.host}${s.url.pathname}`)).toEqual([
        "GET radarr:7878/api/v3/movie",
        "GET radarr:7878/api/v3/diskspace",
        "GET sonarr:8989/api/v3/series"
      ])
      expect(seen.every((s) => s.headers["x-api-key"] === "masked")).toBe(true)
    }).pipe(Effect.provide(callsWith(() => ({ json: [] }), seen)))
  })

  it.effect("a service that doesn't answer is a failure, not an error", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(result).toEqual({ _tag: "Failed", id: "r1", reason: "unreachable" })
    }).pipe(Effect.provide(callsWith(() => ({ unreachable: true }), []))))
})

describe("To fix calls", () => {
  it.effect("removes a queue item with DELETE, and protects in Reclaimerr with its bearer token", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const removed = yield* calls.run(request({ service: "radarr", method: "DELETE", path: "/api/v3/queue/41?removeFromClient=true&blocklist=true" }))
      expect(removed).toMatchObject({ _tag: "CallResponse", status: 200 })
      expect(seen[0]!.method).toBe("DELETE")
      expect(seen[0]!.url.href).toBe("http://radarr:7878/api/v3/queue/41?removeFromClient=true&blocklist=true")

      yield* calls.run(request({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: { reason: "Kept from Quai" } }))
      expect(seen[1]!.url.href).toBe("http://reclaimerr:8000/api/v1/candidates/42/protect")
      expect(seen[1]!.headers["authorization"]).toBe("Bearer masked")
      expect(seen[1]!.headers["x-api-key"]).toBeUndefined()
      expect(JSON.parse(seen[1]!.body!)).toEqual({ reason: "Kept from Quai" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })

  it.effect("approves a Seerr request with its API key, and never creates one", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      const approved = yield* calls.run(request({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve" }))
      expect(approved).toMatchObject({ _tag: "CallResponse", status: 200 })
      expect(seen[0]!.url.href).toBe("http://seerr:5055/api/v1/request/12/approve")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      expect(seen[0]!.body).toBeNull()
      const created = yield* calls.run(request({ service: "seerr", method: "POST", path: "/api/v1/request", body: { mediaType: "movie", mediaId: 1 } }))
      expect(created).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      expect(seen).toHaveLength(1)
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })

  it.effect("refuses a command other than ManualImport without calling Radarr", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      for (const name of ["RescanMovie", "Backup", "MissingMoviesSearch"]) {
        const result = yield* calls.run(request({ service: "radarr", method: "POST", path: "/api/v3/command", body: { name, importMode: "auto", files: [] } }))
        expect(result).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      }
      expect(seen).toHaveLength(0)
      const ok = yield* calls.run(request({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: { name: "ManualImport", importMode: "auto", files: [{ path: "/downloads/a.mkv", movieId: 12, downloadId: "X" }] }
      }))
      expect(ok).toMatchObject({ _tag: "CallResponse" })
      expect(JSON.parse(seen[0]!.body!).name).toBe("ManualImport")
    }).pipe(Effect.provide(callsWith(() => ({ json: { id: 1 } }), seen)))
  })

  it.effect("a release search may take 50 s, a read only 10", () =>
    Effect.gen(function*() {
      const calls = yield* Calls
      const search = yield* Effect.forkChild(calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/release?movieId=12" })))
      const read = yield* Effect.forkChild(calls.run(request({ service: "radarr", method: "GET", path: "/api/v3/queue" })))
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(read)).toEqual({ _tag: "Failed", id: "r1", reason: "timed out" })
      yield* TestClock.adjust("39 seconds")
      expect(search.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(search)).toEqual({ _tag: "Failed", id: "r1", reason: "timed out" })
    }).pipe(Effect.provide(Calls.layer.pipe(
      Layer.provide(ServiceAuth.layer),
      Layer.provide([configLayer(), journalLayer, Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.never))])
    ))))

  it.effect("Reclaimerr unset is not configured", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(request({ service: "reclaimerr", method: "GET", path: "/api/v1/candidates" }))
      expect(result).toEqual({ _tag: "Failed", id: "r1", reason: "reclaimerr is not configured" })
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), [], configLayer({ reclaimerr: null })))))
})

describe("Cleanuparr calls", () => {
  const hash = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
  const settings = {
    enabled: true,
    cronExpression: "0 0/5 * * * ?",
    useAdvancedScheduling: false,
    failedImport: { maxStrikes: 3, ignorePrivate: false, deletePrivate: false, skipIfNotFoundInClient: true, patterns: [], patternMode: "Exclude", changeCategory: false, forceImport: false, forceImportMaxTries: 3 },
    ignoredDownloads: [] as Array<string>,
    processNoContentId: false,
    downloadingMetadataMaxStrikes: 3,
    errored: { maxStrikes: 0, ignorePrivate: false, deletePrivate: false, changeCategory: false }
  }
  const exclude = (body: unknown) => request({ service: "cleanuparr", method: "PUT", path: "/api/configuration/queue_cleaner", body })
  const holding = (current: unknown) => (s: Seen) => s.method === "GET" ? { json: current } : { json: { message: "QueueCleaner configuration updated successfully" } }

  it.effect("reads with its API key", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(request({ service: "cleanuparr", method: "GET", path: "/api/strikes?page=1&pageSize=500" }))
      expect(result).toMatchObject({ _tag: "CallResponse", status: 200 })
      expect(seen[0]!.url.href).toBe("http://cleanuparr:11011/api/strikes?page=1&pageSize=500")
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
    }).pipe(Effect.provide(callsWith(() => ({ json: { items: [] } }), seen)))
  })

  it.effect("excludes a download: reads the settings, then PUTs them back with one more download id", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const result = yield* (yield* Calls).run(exclude({ ...settings, ignoredDownloads: [hash] }))
      expect(result).toMatchObject({ _tag: "CallResponse", status: 200 })
      expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual(["GET /api/configuration/queue_cleaner", "PUT /api/configuration/queue_cleaner"])
      expect(seen.every((s) => s.headers["x-api-key"] === "masked")).toBe(true)
      expect(JSON.parse(seen[1]!.body!).ignoredDownloads).toEqual([hash])
    }).pipe(Effect.provide(callsWith(holding(settings), seen)))
  })

  it.effect("refuses, without writing, settings that change anything else, or what it can't read first", () =>
    Effect.gen(function*() {
      for (const [current, body] of [
        [settings, { ...settings, enabled: false, ignoredDownloads: [hash] }],
        [settings, { ...settings, ignoredDownloads: ["movies"] }],
        [settings, settings],
        [{ ...settings, ignoredDownloads: [hash] }, { ...settings, ignoredDownloads: [] }],
        ["<html>login</html>", { ...settings, ignoredDownloads: [hash] }]
      ] as const) {
        const seen: Array<Seen> = []
        const journal: Array<string> = []
        const result = yield* Effect.gen(function*() {
          const outcome = yield* (yield* Calls).run(exclude(body))
          journal.push(...(yield* (yield* Journal).read({ limit: 10 })).entries.map((e) => e.text))
          return outcome
        }).pipe(Effect.provide(callsWith((s) => typeof current === "string" ? { text: current } : holding(current)(s), seen)))
        expect(result).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
        expect(seen.map((s) => s.method)).toEqual(["GET"])
        expect(journal[0]).toMatch(/^Quai Home refused a call .*: Cleanuparr PUT \/api\/configuration\/queue_cleaner$/)
      }
    }))

  it.effect("two Keeps at once: one after the other, so the second doesn't undo the first", () => {
    const held = { ...settings, ignoredDownloads: [] as Array<string> }
    const other = "B2C3D4E5F60718293A4B5C6D7E8F901234567890"
    // A Cleanuparr that applies the PUTs, and answers its reads a second later.
    const cleanuparr = (s: Seen) => {
      if (s.method === "GET") return { json: structuredClone(held), delay: "1 second" as const }
      held.ignoredDownloads = JSON.parse(s.body!).ignoredDownloads
      return { json: { message: "QueueCleaner configuration updated successfully" } }
    }
    return Effect.gen(function*() {
      const calls = yield* Calls
      // Each Keep sends what the Cloud read before either went through.
      const first = yield* Effect.forkChild(calls.run({ ...exclude({ ...settings, ignoredDownloads: [hash] }), id: "a" }))
      const second = yield* Effect.forkChild(calls.run({ ...exclude({ ...settings, ignoredDownloads: [other] }), id: "b" }))
      for (let i = 0; i < 3; i++) yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(first)).toMatchObject({ _tag: "CallResponse", status: 200 })
      // The second read sees the first write: its body no longer adds one id to what Cleanuparr holds.
      expect(yield* Fiber.join(second)).toEqual({ _tag: "Failed", id: "b", reason: "not allowed" })
      expect(held.ignoredDownloads).toEqual([hash])
      // Sent again from a fresh read, as the Cloud does on the next Keep, it goes through.
      const again = yield* Effect.forkChild(calls.run(exclude({ ...settings, ignoredDownloads: [hash, other] })))
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(again)).toMatchObject({ _tag: "CallResponse", status: 200 })
      expect(held.ignoredDownloads).toEqual([hash, other])
    }).pipe(Effect.provide(callsWith(cleanuparr, [])))
  })

  it.effect("its read not answering is the service not answering, not a refusal; nothing is written", () =>
    Effect.gen(function*() {
      for (const [answer, reason] of [[{ unreachable: true } as const, "unreachable"], [{ status: 401, text: "" }, "HTTP 401"], [{ status: 503, text: "" }, "HTTP 503"]] as const) {
        const seen: Array<Seen> = []
        const lines = yield* Effect.gen(function*() {
          expect(yield* (yield* Calls).run(exclude({ ...settings, ignoredDownloads: [hash] }))).toEqual({ _tag: "Failed", id: "r1", reason })
          return (yield* (yield* Journal).read({ limit: 10 })).entries.map((e) => e.kind)
        }).pipe(Effect.provide(callsWith(() => answer, seen)))
        expect(seen.map((s) => s.method)).toEqual(["GET"])
        expect(lines).toEqual(["service.unreached"])
      }
    }))

  it.effect("its read over maxBodyBytes is unreadable: refused", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      expect(yield* (yield* Calls).run(exclude({ ...settings, ignoredDownloads: [hash] }))).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      expect(seen.map((s) => s.method)).toEqual(["GET"])
    }).pipe(Effect.provide(callsWith(() => ({ text: " ".repeat(HomeProtocol.maxBodyBytes + 1) }), seen)))
  })

  it.effect("the read, the check and the write take at most 12 s together, under the Cloud's wait", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const fiber = yield* Effect.forkChild((yield* Calls).run(exclude({ ...settings, ignoredDownloads: [hash] })))
      yield* TestClock.adjust("11 seconds")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Failed", id: "r1", reason: "timed out" })
      expect(seen.map((s) => s.method)).toEqual(["GET", "PUT"])
    }).pipe(Effect.provide(callsWith((s) => s.method === "GET" ? { json: settings, delay: "6 seconds" } : { json: {}, delay: "1 minute" }, seen)))
  })

  it.effect("a checked write with a query is refused", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const call = { ...exclude({ ...settings, ignoredDownloads: [hash] }), path: "/api/configuration/queue_cleaner?apikey=x" }
      expect(yield* (yield* Calls).run(call)).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      expect(seen).toHaveLength(0)
    }).pipe(Effect.provide(callsWith(holding(settings), seen)))
  })

  it.effect("its other writes are refused without calling it", () => {
    const seen: Array<Seen> = []
    return Effect.gen(function*() {
      const calls = yield* Calls
      for (const r of [
        request({ service: "cleanuparr", method: "PUT", path: "/api/configuration/general", body: { ignoredDownloads: [hash] } }),
        request({ service: "cleanuparr", method: "POST", path: "/api/jobs/QueueCleaner/trigger" }),
        request({ service: "cleanuparr", method: "DELETE", path: "/api/strikes/0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d01" }),
        request({ service: "cleanuparr", method: "GET", path: "/api/account/api-key" })
      ]) {
        expect(yield* calls.run(r)).toEqual({ _tag: "Failed", id: "r1", reason: "not allowed" })
      }
      expect(seen).toHaveLength(0)
    }).pipe(Effect.provide(callsWith(() => ({ json: {} }), seen)))
  })
})

describe("call bodies", () => {
  it.effect("a response over maxBodyBytes is a failure", () =>
    Effect.gen(function*() {
      const calls = yield* Calls
      const status = request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })
      expect(yield* calls.run(status)).toEqual({ _tag: "Failed", id: "r1", reason: "too large" })
    }).pipe(Effect.provide(callsWith(() => ({ text: "x".repeat(HomeProtocol.maxBodyBytes + 1) }), []))))

  it.effect("a body of exactly maxBodyBytes goes through", () =>
    Effect.gen(function*() {
      const result = yield* (yield* Calls).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" }))
      expect(result).toMatchObject({ _tag: "CallResponse", status: 200 })
    }).pipe(Effect.provide(callsWith(() => ({ text: "x".repeat(HomeProtocol.maxBodyBytes) }), []))))
})

describe("call timeout", () => {
  it.effect("a call that hangs fails after 10 s", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild((yield* Calls).run(request({ service: "radarr", method: "GET", path: "/api/v3/system/status" })))
      yield* TestClock.adjust("10 seconds")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Failed", id: "r1", reason: "timed out" })
    }).pipe(Effect.provide(Calls.layer.pipe(
      Layer.provide(ServiceAuth.layer),
      Layer.provide([configLayer(), journalLayer, Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.never))])
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
      const result = yield* (yield* Calls).run(info)
      expect(result).toEqual({ _tag: "CallResponse", id: "r1", status: 200, body: "[]" })
      expect(seen.map((r) => r.url.pathname)).toEqual(["/api/v2/torrents/info", "/api/v2/auth/login", "/api/v2/torrents/info"])
      expect(seen[1]!.body).toBe("username=admin&password=pw")
      expect(seen[2]!.url.searchParams.get("hashes")).toBe("a|b")
    }).pipe(Effect.provide(callsWith(route, seen)))
  })

  it.effect("calls that get a 403 together log in once, and all use the new cookie", () => {
    const seen: Array<Seen> = []
    const route: Route = (r) => {
      if (r.url.pathname === "/api/v2/auth/login") {
        return { delay: "1 second", headers: { "set-cookie": "QBT_SID_8080=s3ss10n; HttpOnly; path=/" } }
      }
      return r.headers["cookie"] === "QBT_SID_8080=s3ss10n" ? { json: [] } : { status: 403 }
    }
    return Effect.gen(function*() {
      const calls = yield* Calls
      const both = yield* Effect.forkChild(Effect.all([calls.run(info), calls.run(info)], { concurrency: "unbounded" }))
      yield* TestClock.adjust("1 second")
      const results = yield* Fiber.join(both)
      expect(results.map((r) => r._tag)).toEqual(["CallResponse", "CallResponse"])
      expect(seen.filter((r) => r.url.pathname === "/api/v2/auth/login")).toHaveLength(1)
    }).pipe(Effect.provide(callsWith(route, seen)))
  })

  it.effect("a wrong password is reported, and never tried again", () => {
    const seen: Array<Seen> = []
    const route: Route = (r) => r.url.pathname === "/api/v2/auth/login" ? { text: "Fails." } : { status: 403 }
    return Effect.gen(function*() {
      const calls = yield* Calls
      const logins = () => seen.filter((r) => r.url.pathname === "/api/v2/auth/login").length
      expect(yield* calls.run(info)).toEqual({ _tag: "Failed", id: "r1", reason: "wrong username or password" })
      yield* TestClock.adjust("1 hour")
      expect(yield* calls.run(info)).toEqual({ _tag: "Failed", id: "r1", reason: "wrong username or password" })
      expect(logins()).toBe(1)
    }).pipe(Effect.provide(callsWith(route, seen)))
  })
})
