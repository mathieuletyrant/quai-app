import { describe, expect, it } from "@effect/vitest"
import * as HomeId from "../src/HomeId.ts"
import { HomeProtocol } from "../src/index.ts"

describe("home id", () => {
  it("is the first 32 hex chars of the SHA-256 of the public key (SPKI DER)", () => {
    // A fixed Ed25519 key, so the id can't change under a home that already linked with it.
    expect(HomeId.homeId("MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=")).toBe(
      "a1e9156054e04fac899ae9f275132cdc"
    )
  })
})

// What the Cloud calls is checked against the allowlist by its own tests: their fake Quai Home
// (apps/cloud/test/fakeHome.ts) refuses, and fails the test on, any call the allowlist refuses.
// Here: what it must refuse, and the body checks.
describe("allowlist", () => {
  // The landing's security section (apps/site/public/index.html, #security) lists these as refused.
  it("refuses what the landing says it refuses", () => {
    const refused = [
      { service: "radarr", method: "DELETE", path: "/api/v3/movie/12" },
      { service: "sonarr", method: "DELETE", path: "/api/v3/series/12" },
      { service: "radarr", method: "POST", path: "/api/v3/command", body: { name: "RescanMovie" } },
      { service: "sonarr", method: "POST", path: "/api/v3/command", body: { name: "SeriesSearch" } },
      { service: "radarr", method: "GET", path: "/api/v3/config/host" },
      { service: "sonarr", method: "GET", path: "/api/v3/config/host" },
      { service: "seerr", method: "GET", path: "/api/v1/settings/main" },
      { service: "seerr", method: "POST", path: "/api/v1/settings/main", body: {} },
      { service: "radarr", method: "PUT", path: "/api/v3/config/mediamanagement", body: {} },
      { service: "sonarr", method: "PUT", path: "/api/v3/config/mediamanagement", body: {} }
    ] as const
    expect(refused.filter((call) => HomeProtocol.allowed(call))).toEqual([])
  })

  it("keeps the library read-only: no write, no single title, no other service's path", () => {
    expect(HomeProtocol.allowed({ service: "radarr", method: "POST", path: "/api/v3/movie" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/movie/12" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/api/v3/series" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/movie" })).toBe(false)
    expect(HomeProtocol.allowed({ service: "sonarr", method: "GET", path: "/api/v3/series/3/../../config/host" })).toBe(
      false
    )
  })
})

describe("allowlist: the To fix list", () => {
  const allowed = HomeProtocol.allowed
  const manualImport = {
    name: "ManualImport",
    importMode: "auto",
    files: [{
      path: "/downloads/Dune.mkv",
      movieId: 12,
      downloadId: "ABC",
      quality: { quality: { id: 7 } },
      languages: [{ id: 1 }]
    }]
  }

  it("Radarr has no episodes to read", () => {
    expect(allowed({ service: "radarr", method: "GET", path: "/api/v3/episode?seriesId=3" })).toBe(false)
  })

  it("removes a queue item only with DELETE on its id, without a body", () => {
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/queue/bulk" })).toBe(false)
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/movie/12" })).toBe(false)
    expect(allowed({ service: "radarr", method: "DELETE", path: "/api/v3/queue/41", body: { ids: [1, 2] } })).toBe(
      false
    )
    expect(allowed({ service: "jellyfin", method: "DELETE", path: "/Items/abc" })).toBe(false)
  })

  it("grabs a release by guid and indexer, nothing else in the body", () => {
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "abc", indexerId: 3 } }))
      .toBe(true)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/release", body: { guid: "abc" } })).toBe(false)
    expect(
      allowed({
        service: "radarr",
        method: "POST",
        path: "/api/v3/release",
        body: { guid: "abc", indexerId: 3, downloadClientId: 9 }
      })
    ).toBe(false)
    expect(
      allowed({ service: "radarr", method: "POST", path: "/api/v3/release/push", body: { guid: "abc", indexerId: 3 } })
    ).toBe(false)
  })

  it("runs ManualImport and no other command", () => {
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: manualImport })).toBe(true)
    for (const name of ["RescanMovie", "MoviesSearch", "Backup", "RenameFiles", "ApplicationUpdate", "manualimport"]) {
      expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, name } }))
        .toBe(false)
    }
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { name: "ManualImport" } }))
      .toBe(false)
    expect(
      allowed({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: { ...manualImport, importMode: "move" }
      })
    ).toBe(false)
    expect(
      allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, files: [] } })
    ).toBe(false)
    expect(
      allowed({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: { ...manualImport, sendUpdatesToClient: true }
      })
    ).toBe(false)
    expect(
      allowed({ service: "radarr", method: "POST", path: "/api/v3/command", body: { ...manualImport, toString: "x" } })
    ).toBe(false)
    // A file with keys ManualImport doesn't take, or without its movie, is refused.
    expect(
      allowed({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: { ...manualImport, files: [{ path: "/x", downloadId: "A" }] }
      })
    ).toBe(false)
    expect(
      allowed({
        service: "radarr",
        method: "POST",
        path: "/api/v3/command",
        body: { ...manualImport, files: [{ ...manualImport.files[0], deleteFiles: true }] }
      })
    ).toBe(false)
    // Sonarr's files name a series and its episodes.
    const episodes = {
      name: "ManualImport",
      importMode: "auto",
      files: [{ path: "/x.mkv", seriesId: 3, seasonNumber: 1, episodeIds: [301], downloadId: "A" }]
    }
    expect(allowed({ service: "sonarr", method: "POST", path: "/api/v3/command", body: episodes })).toBe(true)
    expect(allowed({ service: "sonarr", method: "POST", path: "/api/v3/command", body: manualImport })).toBe(false)
    expect(
      allowed({
        service: "sonarr",
        method: "POST",
        path: "/api/v3/command",
        body: { ...episodes, name: "SeriesSearch" }
      })
    ).toBe(false)
  })

  it("protects one Reclaimerr candidate, nothing else", () => {
    expect(
      allowed({
        service: "reclaimerr",
        method: "POST",
        path: "/api/v1/candidates/42/protect",
        body: { reason: "Kept from Quai" }
      })
    ).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: {} })).toBe(
      true
    )
    expect(
      allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/protect", body: { reason: 3 } })
    ).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/candidates/42/cancel", body: {} })).toBe(
      false
    )
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/tasks/cleanup/run", body: {} })).toBe(false)
    expect(
      allowed({
        service: "reclaimerr",
        method: "POST",
        path: "/api/v1/protections",
        body: { media_type: "movie", tmdb_id: 1 }
      })
    ).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "DELETE", path: "/api/v1/protections/3" })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "GET", path: "/api/settings/services" })).toBe(false)
  })

  it("Reclaimerr's event feed is read, never its webhooks' settings", () => {
    expect(
      allowed({ service: "reclaimerr", method: "GET", path: "/api/v1/events?event_type=candidate.deleted&limit=200" })
    ).toBe(true)
    expect(allowed({ service: "reclaimerr", method: "POST", path: "/api/v1/events", body: {} })).toBe(false)
    expect(allowed({ service: "reclaimerr", method: "GET", path: "/api/settings/integrations/webhooks" })).toBe(false)
    expect(HomeProtocol.goneProtocolVersion).toBeLessThanOrEqual(HomeProtocol.protocolVersion)
  })

  it("a read takes no body; the release search gets a longer timeout", () => {
    expect(allowed({ service: "radarr", method: "GET", path: "/api/v3/queue", body: { a: 1 } })).toBe(false)
    expect(
      HomeProtocol.allowRule({ service: "radarr", method: "GET", path: "/api/v3/release?movieId=1" })?.timeoutSeconds
    ).toBe(HomeProtocol.releaseSearchTimeoutSeconds)
    expect(HomeProtocol.allowRule({ service: "radarr", method: "GET", path: "/api/v3/queue" })?.timeoutSeconds)
      .toBeUndefined()
  })
})

describe("allowlist: Seerr", () => {
  const allowed = HomeProtocol.allowed

  it("approves or declines one request, with no body", () => {
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve" })).toBe(true)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/decline" })).toBe(true)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/approve", body: { is4k: true } }))
      .toBe(false)
  })

  it("searches, lists the users, and requests a movie or some seasons, for another user or not", () => {
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/search?query=dune&page=1" })).toBe(true)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/user?take=100" })).toBe(true)
    expect(
      allowed({
        service: "seerr",
        method: "POST",
        path: "/api/v1/request",
        body: { mediaType: "movie", mediaId: 438631 }
      })
    ).toBe(true)
    expect(
      allowed({
        service: "seerr",
        method: "POST",
        path: "/api/v1/request",
        body: { mediaType: "movie", mediaId: 438631, userId: 2 }
      })
    ).toBe(true)
    expect(
      allowed({
        service: "seerr",
        method: "POST",
        path: "/api/v1/request",
        body: { mediaType: "tv", mediaId: 95396, seasons: [1, 2] }
      })
    ).toBe(true)
    expect(
      allowed({
        service: "seerr",
        method: "POST",
        path: "/api/v1/request",
        body: { mediaType: "tv", mediaId: 95396, seasons: [1], userId: 2 }
      })
    ).toBe(true)
  })

  it("requests nothing else: no 4K, server, profile or root folder, no \"all\" seasons, no seasons on a movie", () => {
    const request = (body: unknown) => allowed({ service: "seerr", method: "POST", path: "/api/v1/request", body })
    expect(request({ mediaType: "movie", mediaId: 1, is4k: true })).toBe(false)
    expect(request({ mediaType: "movie", mediaId: 1, profileId: 4 })).toBe(false)
    expect(request({ mediaType: "movie", mediaId: 1, rootFolder: "/" })).toBe(false)
    expect(request({ mediaType: "movie", mediaId: 1, seasons: [1] })).toBe(false)
    expect(request({ mediaType: "tv", mediaId: 1, seasons: "all" })).toBe(false)
    expect(request({ mediaType: "tv", mediaId: 1, seasons: [] })).toBe(false)
    expect(request({ mediaType: "tv", mediaId: 1, seasons: [0] })).toBe(false)
    expect(request({ mediaType: "tv", mediaId: 1, seasons: [1, 1] })).toBe(false)
    expect(request({ mediaType: "tv", mediaId: 1 })).toBe(false)
    expect(request({ mediaType: "music", mediaId: 1 })).toBe(false)
    expect(request({ mediaType: "movie", mediaId: "1" })).toBe(false)
    expect(request({ mediaType: "movie", mediaId: 1, userId: "admin" })).toBe(false)
    expect(request(undefined)).toBe(false)
  })

  it("refuses every other write: retrying or deleting a request, the settings, the users", () => {
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/retry" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/pending" })).toBe(false)
    expect(allowed({ service: "seerr", method: "DELETE", path: "/api/v1/request/12" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/request/12/../../settings/main/regenerate" }))
      .toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/settings/notifications/webhook" })).toBe(false)
    expect(
      allowed({
        service: "seerr",
        method: "POST",
        path: "/api/v1/settings/notifications/webhook",
        body: { enabled: true }
      })
    ).toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/settings/main" })).toBe(false)
    expect(allowed({ service: "seerr", method: "POST", path: "/api/v1/user", body: { email: "x" } })).toBe(false)
    expect(allowed({ service: "seerr", method: "GET", path: "/api/v1/user/1/settings/main" })).toBe(false)
    expect(allowed({ service: "radarr", method: "POST", path: "/api/v1/request/12/approve" })).toBe(false)
  })
})

describe("allowlist: the calendars", () => {
  it("never writes to Radarr's and Sonarr's calendar, nor reads one entry", () => {
    for (const service of ["radarr", "sonarr"] as const) {
      expect(HomeProtocol.allowed({ service, method: "POST", path: "/api/v3/calendar" })).toBe(false)
      expect(HomeProtocol.allowed({ service, method: "GET", path: "/api/v3/calendar/12" })).toBe(false)
    }
    expect(HomeProtocol.allowed({ service: "radarr", method: "GET", path: "/feed/v3/calendar/radarr.ics" })).toBe(false)
  })
})

describe("allowlist: Cleanuparr", () => {
  const allowed = HomeProtocol.allowed
  const hash = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
  /** `GET /api/configuration/queue_cleaner`, as Cleanuparr 2.11 answers it. */
  const current = {
    enabled: true,
    cronExpression: "0 0/5 * * * ?",
    useAdvancedScheduling: false,
    failedImport: {
      maxStrikes: 3,
      ignorePrivate: false,
      deletePrivate: false,
      skipIfNotFoundInClient: true,
      patterns: ["sample"],
      patternMode: "Include",
      changeCategory: false,
      forceImport: false,
      forceImportMaxTries: 3
    },
    ignoredDownloads: ["0718293A4B5C6D7E8F901234567890123456789A"],
    processNoContentId: false,
    downloadingMetadataMaxStrikes: 3,
    errored: { maxStrikes: 0, ignorePrivate: false, deletePrivate: false, changeCategory: false }
  }
  const ignoring = (...more: ReadonlyArray<string>) => ({
    ...current,
    ignoredDownloads: [...current.ignoredDownloads, ...more]
  })
  const check = HomeProtocol.ignoresOneMoreDownload

  it("reads its strikes, settings, rules, next run and events, and nothing else", () => {
    for (
      const path of [
        "/health",
        "/api/strikes?page=1&pageSize=500",
        "/api/configuration/queue_cleaner",
        "/api/queue-rules/stall",
        "/api/queue-rules/slow",
        "/api/jobs/QueueCleaner",
        "/api/events?eventType=QueueItemDeleted"
      ]
    ) {
      expect(allowed({ service: "cleanuparr", method: "GET", path })).toBe(true)
    }
    for (
      const path of [
        "/api/configuration/general",
        "/api/configuration/download_client",
        "/api/account/api-key",
        "/api/arr/radarr",
        "/api/jobs"
      ]
    ) {
      expect(allowed({ service: "cleanuparr", method: "GET", path })).toBe(false)
    }
  })

  it("its one write is the queue cleaner's settings, checked against what Cleanuparr holds", () => {
    const rule = HomeProtocol.allowRule({
      service: "cleanuparr",
      method: "PUT",
      path: "/api/configuration/queue_cleaner",
      body: ignoring(hash)
    })
    expect(rule?.against?.path).toBe("/api/configuration/queue_cleaner")
    expect(allowed({ service: "cleanuparr", method: "PUT", path: "/api/configuration/queue_cleaner" })).toBe(false)
    // A query could change what the write means: the checked write goes to the document exactly.
    expect(
      allowed({
        service: "cleanuparr",
        method: "PUT",
        path: "/api/configuration/queue_cleaner?apikey=other",
        body: ignoring(hash)
      })
    ).toBe(false)
    expect(HomeProtocol.checkedWriteTimeoutSeconds * 1000).toBeLessThan(15_000)
    expect(allowed({ service: "cleanuparr", method: "PUT", path: "/api/configuration/general", body: ignoring(hash) }))
      .toBe(false)
    expect(allowed({ service: "cleanuparr", method: "POST", path: "/api/jobs/QueueCleaner/trigger" })).toBe(false)
    expect(
      allowed({ service: "cleanuparr", method: "DELETE", path: "/api/strikes/0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d01" })
    ).toBe(false)
    expect(allowed({ service: "cleanuparr", method: "POST", path: "/api/configuration/strikes/purge" })).toBe(false)
  })

  it("lets only one more download id into the ignore list, everything else as it is", () => {
    expect(check(current, ignoring(hash))).toBe(true)
    expect(check(current, ignoring("SABnzbd_nzo_kyt1f0"))).toBe(true)
    // Keys in another order are the same settings.
    expect(check(current, Object.fromEntries(Object.entries(ignoring(hash)).reverse()))).toBe(true)
    // Nothing added, two added, one already there, one removed.
    expect(check(current, current)).toBe(false)
    expect(check(current, ignoring(hash, "B2C3D4E5F60718293A4B5C6D7E8F901234567890"))).toBe(false)
    expect(check(current, ignoring(current.ignoredDownloads[0]!.toLowerCase()))).toBe(false)
    expect(check(current, { ...current, ignoredDownloads: [hash] })).toBe(false)
    // A category, a tag or a tracker would spare every download it covers.
    for (const pattern of ["radarr", "tv-sonarr", "tracker.example.org", ""]) {
      expect(check(current, ignoring(pattern))).toBe(false)
    }
    // Any other setting changed: the cleaner turned off, its schedule, its strikes, a field dropped or added.
    expect(check(current, { ...ignoring(hash), enabled: false })).toBe(false)
    expect(check(current, { ...ignoring(hash), cronExpression: "0 0 0 1 1 ?" })).toBe(false)
    expect(check(current, { ...ignoring(hash), failedImport: { ...current.failedImport, maxStrikes: 0 } })).toBe(false)
    const { errored: _, ...withoutErrored } = ignoring(hash)
    expect(check(current, withoutErrored)).toBe(false)
    expect(check(current, { ...ignoring(hash), stallRules: [] })).toBe(false)
    expect(check("not json", ignoring(hash))).toBe(false)
    // Cleanuparr answering null for an empty list.
    expect(check({ ...current, ignoredDownloads: null }, { ...current, ignoredDownloads: [hash] })).toBe(true)
  })

  it("a download id is a torrent hash or a SABnzbd job, never a category, tag or tracker", () => {
    expect(HomeProtocol.isDownloadId(hash)).toBe(true)
    expect(HomeProtocol.isDownloadId("SABnzbd_nzo_kyt1f0")).toBe(true)
    for (const id of ["12345", "radarr", hash.slice(1), `${hash}0`, "SABnzbd_nzo_", 42]) {
      expect(HomeProtocol.isDownloadId(id)).toBe(false)
    }
  })
})

describe("console relay", () => {
  it("relays the console's routes and the Cloud's health, nothing else", () => {
    expect(HomeProtocol.isConsolePath("/console-api/devices")).toBe(true)
    expect(HomeProtocol.isConsolePath("/console-api/journal?limit=5")).toBe(true)
    expect(HomeProtocol.isConsolePath("/api/health")).toBe(true)
    expect(HomeProtocol.isConsolePath("/api/activities")).toBe(false)
    expect(HomeProtocol.isConsolePath("/console-api")).toBe(false)
    expect(HomeProtocol.isConsolePath("/console-api/../api/activities")).toBe(false)
    expect(HomeProtocol.isConsolePath("/home")).toBe(false)
  })
})
