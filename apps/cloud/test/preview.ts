import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { HomeRoutes } from "../src/App.ts"
import { HomeLinks } from "../src/home/HomeLink.ts"
import { torrentsWatchId } from "../src/integrations/qbittorrent.ts"
import { PublicAccess } from "../src/PublicAccess.ts"
import { Apns } from "../src/push/Apns.ts"
import { ServerInfo } from "../src/Version.ts"
import { type FakeHome, makeFakeHome, recordedHome, type Recording, testHomeId } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"

/**
 * Quai Cloud on a real port, linked to the tests' fake Quai Home answering from the recorded
 * fixtures: what the iPhone app (or the console) shows of a home, without a stack. Run with
 * `pnpm --filter @quai/cloud preview`; pair from `POST /console-api/pairing-codes`.
 */

/** The fixtures were recorded around this day. The preview moves their dates to today. */
const recordedDay = Date.parse("2026-11-20T00:00:00Z")
const dayMs = 24 * 60 * 60 * 1000

const isoDate = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)"/g

/** A fixture with every ISO date moved by whole days, so "today" is today. */
const shifted = (path: string, days: number): Recording => {
  const text = JSON.stringify(fixture(path)).replace(isoDate, (_, date: string) => {
    const moved = new Date(Date.parse(date.endsWith("Z") ? date : `${date}Z`) + days * dayMs).toISOString()
    return `"${date.endsWith("Z") ? moved : moved.replace("Z", "")}"`
  })
  return { json: JSON.parse(text) }
}

const previewRoutes = (days: number): Readonly<Record<string, Recording>> => ({
  "radarr GET /api/v3/movie": "radarr/movies.json",
  "radarr GET /api/v3/diskspace": "radarr/diskspace.json",
  "radarr GET /api/v3/rootfolder": "radarr/rootfolder.json",
  "sonarr GET /api/v3/series": "sonarr/series.json",
  "sonarr GET /api/v3/diskspace": "sonarr/diskspace.json",
  "sonarr GET /api/v3/rootfolder": "sonarr/rootfolder.json",
  "radarr GET /api/v3/queue": shifted("radarr/queue.json", days),
  "radarr GET /api/v3/wanted/missing": "radarr/wanted-missing.json",
  "radarr GET /api/v3/history/since": shifted("radarr/history-since.json", days),
  "radarr GET /api/v3/release": "radarr/release.json",
  "radarr GET /api/v3/manualimport": "radarr/manualimport.json",
  "radarr GET /api/v3/calendar": shifted("radarr/calendar.json", days),
  "sonarr GET /api/v3/queue": shifted("sonarr/queue.json", days),
  "sonarr GET /api/v3/wanted/missing": "sonarr/wanted-missing.json",
  "sonarr GET /api/v3/history/since": shifted("sonarr/history-since.json", days),
  "sonarr GET /api/v3/release": "sonarr/release.json",
  "sonarr GET /api/v3/manualimport": "sonarr/manualimport.json",
  "sonarr GET /api/v3/episode": "sonarr/episodes.json",
  "sonarr GET /api/v3/calendar": shifted("sonarr/calendar.json", days),
  "reclaimerr GET /api/v1/candidates": shifted("reclaimerr/candidates.json", days),
  // Its deletion task runs at 02:00: next, tomorrow's.
  "reclaimerr GET /api/v1/tasks/delete_cleanup_candidates": {
    json: {
      ...(fixture("reclaimerr/deletion-task.json") as object),
      next_run_at: new Date(recordedDay + (days + 1) * dayMs + 2 * 3600_000).toISOString()
    }
  },
  "seerr GET /api/v1/request": "seerr/requests-pending.json",
  "seerr GET /api/v1/movie/516729": "seerr/movie.json",
  "seerr GET /api/v1/tv/95396": "seerr/tv.json",
  "seerr GET /api/v1/tv/90228": "seerr/tv-prophecy.json",
  "seerr GET /api/v1/search": "seerr/search-dune.json",
  "seerr GET /api/v1/user": "seerr/users.json",
  "seerr POST /api/v1/request": { status: 201, json: fixture("seerr/request-created.json") },
  "cleanuparr GET /api/strikes": shifted("cleanuparr/strikes.json", days),
  "cleanuparr GET /api/configuration/queue_cleaner": "cleanuparr/queue-cleaner.json",
  "cleanuparr GET /api/queue-rules/stall": "cleanuparr/stall-rules.json",
  "cleanuparr GET /api/queue-rules/slow": "cleanuparr/slow-rules.json",
  "cleanuparr GET /api/jobs/QueueCleaner": shifted("cleanuparr/job-queue-cleaner.json", days),
  "cleanuparr GET /api/events": shifted("cleanuparr/events-removed.json", days),
  "cleanuparr GET /api/configuration/download_cleaner": "cleanuparr/download-cleaner.json",
  "cleanuparr GET /api/jobs/DownloadCleaner": shifted("cleanuparr/job-download-cleaner.json", days),
  "radarr GET /api/v3/config/mediamanagement": "radarr/mediamanagement.json",
  "sonarr GET /api/v3/config/mediamanagement": "radarr/mediamanagement.json",
  // Upcoming's finished torrents; the download's progress comes from the watch's snapshots below.
  "qbittorrent GET /api/v2/torrents/info": "real/qbittorrent/torrents-info.json",
  "jellyfin GET /Items": "jellyfin/items-movie.json",
  "jellyfin GET /Users": "jellyfin/users.json"
})

/** The fixtures' media disk (`/downloads`, Radarr's and Sonarr's root folders). */
const previewDisk = {
  id: "d1800360124416",
  name: "Movies · Shows",
  holds: ["movies", "shows"],
  totalBytes: 1800360124416
}

/**
 * Forty days of hourly readings of the media disk, ending at the fixtures' free space, and what
 * changed it: imports drain it, a deletion and a seed cleanup give some back, one gives nothing.
 */
const storageHistory = (now: number): ReadonlyArray<readonly [string, unknown]> => {
  const hour = 3600_000
  const end = 759102349312
  const marks = [
    { daysAgo: 33, kind: "arrived", service: "radarr", title: "Dune", detail: "Imported", bytes: 12e9 },
    {
      daysAgo: 26,
      kind: "arrived",
      service: "sonarr",
      title: "Severance S02",
      detail: "8 episodes imported",
      bytes: 18e9
    },
    {
      daysAgo: 19,
      kind: "gone",
      service: "reclaimerr",
      title: "The Vampire Diaries S07",
      detail: "Deleted",
      bytes: 24e9,
      holds: "shows"
    },
    { daysAgo: 12, kind: "gone", service: "cleanuparr", title: "Dune: Part Two", detail: "Seed cleanup", bytes: 0 },
    {
      daysAgo: 6,
      kind: "arrived",
      service: "sonarr",
      title: "Slow Horses S04",
      detail: "6 episodes imported",
      bytes: 11e9
    },
    {
      daysAgo: 2,
      kind: "gone",
      service: "cleanuparr",
      title: "The Bear S03",
      detail: "Seed cleanup",
      bytes: 6e9
    }
  ].map(({ daysAgo, ...mark }) => {
    const at = now - daysAgo * 24 * hour
    const holds = mark.service === "radarr" ? "movies" : mark.service === "sonarr" ? "shows" : undefined
    const { bytes, ...rest } = mark
    return {
      id: `${mark.kind}:preview:${daysAgo}`,
      at,
      ...rest,
      ...(bytes > 0 ? { bytes } : {}),
      ...(holds === undefined ? {} : { holds })
    }
  })
  // Backwards from now: an import costs its size before it, what's gone gives its size back.
  const readings: Array<[number, number]> = []
  let free = end
  for (let at = now - (now % hour); at > now - 40 * 24 * hour; at -= hour) {
    readings.unshift([at, free])
    free += 0.06e9
    for (const mark of marks) {
      if (mark.at >= at - hour && mark.at < at) free += mark.kind === "arrived" ? mark.bytes ?? 0 : -(mark.bytes ?? 0)
    }
  }
  const byMonth = new Map<string, Array<[number, number]>>()
  for (const reading of readings) {
    const month = new Date(reading[0]).toISOString().slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), reading])
  }
  const marksByMonth = new Map<string, Array<typeof marks[number]>>()
  for (const mark of marks) {
    const month = new Date(mark.at).toISOString().slice(0, 7)
    marksByMonth.set(month, [...(marksByMonth.get(month) ?? []), mark])
  }
  return [
    [`storage/disks/${previewDisk.id}`, previewDisk],
    ...[...byMonth].map(([month, list]) =>
      [`storage/readings/${previewDisk.id}/${month}`, { readings: list }] as const
    ),
    ...[...marksByMonth].map(([month, list]) => [`storage/marks/${month}`, { marks: list }] as const)
  ]
}

/** Something going on: Dune downloading at 42 %. */
const downloading = (home: FakeHome) =>
  Effect.gen(function*() {
    yield* home.webhook("radarr", fixture("radarr/movie-added.json"))
    yield* home.webhook("radarr", fixture("radarr/grab.json"))
    yield* home.snapshot(torrentsWatchId, (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
  })

const FakeHomeLinked = Layer.effectDiscard(
  Effect.gen(function*() {
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    const days = Math.floor((now - recordedDay) / dayMs)
    const home = yield* makeFakeHome({
      strict: false,
      services: ["radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "reclaimerr", "cleanuparr"],
      webUrls: {
        radarr: ["http://umbrel.local:7878", "https://radarr.example.com"],
        sonarr: ["http://umbrel.local:8989"]
      },
      answer: recordedHome(previewRoutes(days))
    })
    for (const [key, value] of storageHistory(now)) home.documents.set(key, value)
    yield* home.connect
    yield* downloading(home)
    // The fake Quai Home keeps answering the snapshot of the torrent: Quai Home polls it every few seconds.
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.andThen(
          Effect.sleep("5 seconds"),
          home.snapshot(torrentsWatchId, (fixture("qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
        )
      )
    )
    yield* Effect.logInfo("Preview: Quai Cloud linked to a fake Quai Home. Pair with POST /console-api/pairing-codes.")
  })
)

const HttpLive = Layer.unwrap(
  Effect.gen(function*() {
    const port = yield* Config.Port("QUAI_PORT").pipe(Config.withDefault(8787))
    return NodeHttpServer.layer(createServer, { port })
  })
)

// One home's routes, as main.ts builds them for each home, on the fake Quai Home linked in memory.
// The console's routes answer on the public port here: the preview has no Quai Home to relay them.
const Shared = Layer.mergeAll(HomeLinks.linkOf(testHomeId), Layer.effect(Apns, Apns.make(null)), PublicAccess.layer)

HttpRouter.serve(Layer.mergeAll(HomeRoutes, FakeHomeLinked)).pipe(
  Layer.provide(Shared),
  Layer.provide(Layer.succeed(ServerInfo, { version: "preview", startedAt: Date.now() })),
  Layer.provide(HttpLive),
  Layer.launch,
  NodeRuntime.runMain
)
