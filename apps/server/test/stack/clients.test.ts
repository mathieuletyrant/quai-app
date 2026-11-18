import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { ensureWebhook } from "../../src/stack/ArrWebhooks.ts"
import { Jellyfin } from "../../src/stack/Jellyfin.ts"
import { QBittorrent } from "../../src/stack/QBittorrent.ts"
import { StackConfig } from "../../src/stack/StackConfig.ts"
import { fakeHttp, type Seen } from "../fakeHttp.ts"
import { fixture } from "../fixtures.ts"

const key = Redacted.make("masked")
const config = Layer.succeed(StackConfig, {
  radarr: { url: "http://radarr:7878", apiKey: key },
  sonarr: null,
  qbittorrent: { url: "http://qbittorrent:8080", username: "admin", password: Redacted.make("pw") },
  jellyfin: { url: "http://jellyfin:8096", apiKey: key },
  internalUrl: "http://quai:8787"
})

describe("qBittorrent", () => {
  it.effect("reads progress, and logs in again when the session expired", () => {
    const seen: Array<Seen> = []
    let loggedIn = false
    const http = fakeHttp((r) => {
      if (r.url.pathname === "/api/v2/auth/login") {
        loggedIn = true
        return { status: 200, headers: { "set-cookie": "SID=s3ss10n; HttpOnly; path=/" } }
      }
      if (!loggedIn) return { status: 403 }
      return { json: fixture("qbittorrent/torrents-info.json") }
    }, seen)
    return Effect.gen(function*() {
      const qb = yield* QBittorrent
      const events = yield* qb.progress(["8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"])
      expect(events).toEqual([
        {
          _tag: "Progress",
          downloadId: "8f1c0e3a9b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e",
          progress: 0.4199,
          bytesPerSecond: 8388608,
          remainingSeconds: 683
        },
        {
          _tag: "Progress",
          downloadId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          progress: 0,
          bytesPerSecond: 0,
          remainingSeconds: null
        }
      ])
      expect(seen.map((r) => r.url.pathname)).toEqual([
        "/api/v2/torrents/info",
        "/api/v2/auth/login",
        "/api/v2/torrents/info"
      ])
      expect(seen[2]!.headers["cookie"]).toBe("SID=s3ss10n")
      expect(seen[2]!.url.searchParams.get("hashes")).toContain("|")
    }).pipe(Effect.provide(QBittorrent.layer.pipe(Layer.provide([config, http]))))
  })
})

describe("Jellyfin", () => {
  const http = fakeHttp((r) => {
    if (r.url.pathname === "/Items") {
      return { json: fixture(r.url.searchParams.get("IncludeItemTypes") === "Movie" ? "jellyfin/items-movie.json" : "jellyfin/items-series.json") }
    }
    return { json: fixture("jellyfin/episodes.json") }
  })
  const run = <A, E>(effect: Effect.Effect<A, E, Jellyfin>) =>
    effect.pipe(Effect.provide(Jellyfin.layer.pipe(Layer.provide([config, http]))))

  it.effect("finds a movie by its TMDB id, not by its title", () =>
    run(Effect.gen(function*() {
      const jellyfin = yield* Jellyfin
      expect(yield* jellyfin.find({ _tag: "Movie", mediaKey: "m", tmdbId: 693134, title: "Dune" }))
        .toBe("f9e8d7c6b5a4938271605f4e3d2c1b0a")
      expect(yield* jellyfin.find({ _tag: "Movie", mediaKey: "m", tmdbId: 1, title: "Dune" })).toBeNull()
    })))

  it.effect("episodes count once they have a file, not when they are only listed", () =>
    run(Effect.gen(function*() {
      const jellyfin = yield* Jellyfin
      const check = (episodes: Array<{ season: number; episode: number }>) =>
        jellyfin.find({ _tag: "Episodes", mediaKey: "s", tvdbId: 371980, title: "Severance", episodes })
      expect(yield* check([{ season: 2, episode: 1 }, { season: 2, episode: 2 }])).toBe("5e7e7a1c2b3d4f5061728394a5b6c7d8")
      expect(yield* check([{ season: 2, episode: 3 }])).toBeNull()
    })))
})

describe("webhook setup", () => {
  it.effect("creates Quai's webhook once, then updates it in place", () => {
    const seen: Array<Seen> = []
    let existing: Array<object> = [{ id: 3, name: "Discord", implementation: "Discord" }]
    const http = fakeHttp((r) => {
      if (r.method === "GET") return { json: existing }
      existing = [...existing, { id: 9, name: "Quai", implementation: "Webhook" }]
      return { status: r.method === "POST" ? 201 : 202, json: {} }
    }, seen)
    return Effect.gen(function*() {
      const endpoint = { url: "http://radarr:7878", apiKey: key }
      expect(yield* ensureWebhook("radarr", endpoint, "http://quai:8787/webhooks/radarr?token=t")).toBe("created")
      expect(yield* ensureWebhook("radarr", endpoint, "http://quai:8787/webhooks/radarr?token=t")).toBe("updated")
      expect(seen.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
        "GET /api/v3/notification",
        "POST /api/v3/notification",
        "GET /api/v3/notification",
        "PUT /api/v3/notification/9"
      ])
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      const body = JSON.parse(seen[1]!.body!)
      expect(body).toMatchObject({ name: "Quai", implementation: "Webhook", onGrab: true, onDownload: true, onMovieAdded: true })
      expect(body.fields).toContainEqual({ name: "url", value: "http://quai:8787/webhooks/radarr?token=t" })
    }).pipe(Effect.provide(http))
  })
})
