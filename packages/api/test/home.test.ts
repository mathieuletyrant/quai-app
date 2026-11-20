import { describe, expect, it } from "@effect/vitest"
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import { HomeProtocol } from "../src/index.ts"

describe("home id", () => {
  it("is the first 32 hex chars of the SHA-256 of the public key (SPKI DER)", () => {
    for (let i = 0; i < 5; i++) {
      const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64")
      const expected = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32)
      expect(HomeProtocol.homeId(publicKey)).toBe(expected)
    }
  })

  it("hashes any length, across block boundaries", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const bytes = randomBytes(length)
      const expected = createHash("sha256").update(bytes).digest("hex").slice(0, 32)
      expect(HomeProtocol.homeId(bytes.toString("base64"))).toBe(expected)
    }
  })
})

describe("allowlist", () => {
  it("lets the library reads through: Radarr's movies and disk, Sonarr's series and disk", () => {
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/movie" })).toBe(true)
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/diskspace" })).toBe(true)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/series" })).toBe(true)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/diskspace" })).toBe(true)
  })

  it("keeps the library read-only: no write, no single title, no other service's path", () => {
    expect(HomeProtocol.allowed({ service: "radarr", method: "POST", path: "/api/v3/movie" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/movie/12" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/series" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/movie" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/series/3/../../config/host" })).toBe(false)
  })
})

describe("allowlist: the To fix list", () => {
  const allowed = HomeProtocol.allowed
  const manualImport = {
    name: "ManualImport",
    importMode: "auto",
    files: [{ path: "/downloads/Dune.mkv", movieId: 12, downloadId: "ABC", quality: { quality: { id: 7 } }, languages: [{ id: 1 }] }]
  }

  it("reads the queue, what's missing, the grabs and the manual import, in both *arr", () => {
    for (const service of ["radarr", "sonarr"] as const) {
      for (const path of ["/api/v3/queue?includeUnknownMovieItems=true", "/api/v3/wanted/missing", "/api/v3/history/since?date=2026-11-01", "/api/v3/release?movieId=12", "/api/v3/manualimport?downloadId=ABC"]) {
        expect(allowed({ service, method: "GET", path })).toBe(true)
      }
    }
    expect(allowed({ service: "sonarr", method: "GET", path: "/api/v3/episode?seriesId=3" })).toBe(true)
    expect(allowed({ service: "radarr", method: "GET", path: "/api/v3/episode?seriesId=3" })).toBe(false)
  })

  it("removes one queue item, and only with DELETE on its id", () => {
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/queue/41?removeFromClient=true&blocklist=false" })).toBe(true)
    expect(allowed({ service: "sonarr", method: "DELETE", path: "/api/v3/queue/7" })).toBe(true)
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/queue/bulk" })).toBe(false)
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/movie/12" })).toBe(false)
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/queue/41", body: { ids: [1, 2] } })).toBe(false)
    expect(allowed({ service: "jellyfin", method: "DELETE", path: "/Items/abc" })).toBe(false)
  })

  it("grabs a release by guid and indexer, nothing else in the body", () => {
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "abc", indexerId: 3 } })).toBe(true)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "abc" } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "abc", indexerId: 3, downloadClientId: 9 } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release/push", body: { guid: "abc", indexerId: 3 } })).toBe(false)
  })

  it("runs ManualImport and no other command", () => {
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: manualImport })).toBe(true)
    for (const name of ["RescanMovie", "MoviesSearch", "Backup", "RenameFiles", "ApplicationUpdate", "manualimport"]) {
      expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, name } })).toBe(false)
    }
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { name: "ManualImport" } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, importMode: "move" } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, files: [] } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, sendUpdatesToClient: true } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, toString: "x" } })).toBe(false)
    // A file with keys ManualImport doesn't take, or without its movie, is refused.
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, files: [{ path: "/x", downloadId: "A" }] } })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, files: [{ ...manualImport.files[0], deleteFiles: true }] } })).toBe(false)
    // Sonarr's files name a series and its episodes.
    const episodes = { name: "ManualImport", importMode: "auto", files: [{ path: "/x.mkv", seriesId: 3, seasonNumber: 1, episodeIds: [301], downloadId: "A" }] }
    expect(allowed({ service: "sonarr", method: "POST", path: "/api/v3/command", body: episodes })).toBe(true)
    expect(allowed({ service: "sonarr", method: "POST", path: "/api/v3/command", body: manualImport })).toBe(false)
    expect(allowed({ service: "sonarr", method: "POST", path: "/api/v3/command", body: { ...episodes, name: "SeriesSearch" } })).toBe(false)
  })

  it("reads Reclaimerr's candidates and protects one, nothing else", () => {
    expect(allowed({ service: "reclaimerr", method: "GET", path: "/api/v1/system" })).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "GET", path: "/api/v1/candidates?page=1&per_page=200" })).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: { reason: "Kept from Quai" } })).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: {} })).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: { reason: 3 } })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/cancel", body: {} })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/tasks/cleanup/run", body: {} })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/protections", body: { media_type: "movie", tmdb_id: 1 } })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "DELETE", path: "/api/v1/protections/3" })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "GET", path: "/api/settings/services" })).toBe(false)
  })

  it("a read takes no body; the release search gets a longer timeout", () => {
    expect(allowed({ service: "radarr", method: "GET", path: "/api/v3/queue", body: { a: 1 } })).toBe(false)
    expect(HomeProtocol.allowRule({ service: "radarr", method: "GET", path: "/api/v3/release?movieId=1" })?.timeoutSeconds).toBe(HomeProtocol.releaseSearchTimeoutSeconds)
    expect(HomeProtocol.allowRule({ service: "radarr", method: "GET", path: "/api/v3/queue" })?.timeoutSeconds).toBeUndefined()
  })
})

describe("allowlist: Seerr", () => {
  const allowed = HomeProtocol.allowed

  it("reads the status, the requests and the titles they ask for", () => {
    for (const path of ["/api/v1/status", "/api/v1/request?take=50&skip=0&filter=pending&sort=added", "/api/v1/request/12", "/api/v1/movie/1022789", "/api/v1/tv/95396"]) {
      expect(allowed({ service: "seerr", method: "GET", path })).toBe(true)
    }
  })

  it("approves or declines one request, with no body", () => {
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve" })).toBe(true)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/decline" })).toBe(true)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve", body: { is4k: true } })).toBe(false)
  })

  it("refuses every other write: creating, retrying or deleting a request, the settings, the users", () => {
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request", body: { mediaType: "movie", mediaId: 1 } })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/retry" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/pending" })).toBe(false)
    expect(allowed({ service: "seerr", method: "DELETE", path: "/api/v1/request/12" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/../../settings/main/regenerate" })).toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/settings/notifications/webhook" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/settings/notifications/webhook", body: { enabled: true } })).toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/settings/main" })).toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/user" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v1/request/12/approve" })).toBe(false)
  })
})
