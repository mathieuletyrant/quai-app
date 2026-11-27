import { torrentsWatchId } from "@quai/domain/integrations/qbittorrent.ts"
import { Effect } from "effect"
import type { FakeHome, Recording } from "./fakeHome.ts"
import { fixture } from "./fixtures.ts"

/**
 * The home the preview server (and the demo home on demo.quai.stream) shows: the demo fixtures
 * (`fixtures/demo`: open movies by the Blender Foundation, made-up series, no other image), dates
 * moved to today.
 */

/** The fixtures were recorded around this day. The preview moves their dates to today. */
export const recordedDay = Date.parse("2026-11-20T00:00:00Z")
export const dayMs = 24 * 60 * 60 * 1000

const isoDate = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)"/g

/** A fixture with every ISO date moved by whole days, so "today" is today. */
const shifted = (path: string, days: number): Recording => {
  const text = JSON.stringify(fixture(path)).replace(isoDate, (_, date: string) => {
    const moved = new Date(Date.parse(date.endsWith("Z") ? date : `${date}Z`) + days * dayMs).toISOString()
    return `"${date.endsWith("Z") ? moved : moved.replace("Z", "")}"`
  })
  return { json: JSON.parse(text) }
}

/** Every route the preview's Quai Home answers. */
export const previewRoutes = (days: number): Readonly<Record<string, Recording>> => ({
  "radarr GET /api/v3/movie": "demo/radarr/movies.json",
  "radarr GET /api/v3/diskspace": "demo/radarr/diskspace.json",
  "radarr GET /api/v3/rootfolder": "demo/radarr/rootfolder.json",
  "sonarr GET /api/v3/series": "demo/sonarr/series.json",
  "sonarr GET /api/v3/diskspace": "demo/sonarr/diskspace.json",
  "sonarr GET /api/v3/rootfolder": "demo/sonarr/rootfolder.json",
  "radarr GET /api/v3/queue": shifted("demo/radarr/queue.json", days),
  "radarr GET /api/v3/wanted/missing": "demo/radarr/wanted-missing.json",
  "radarr GET /api/v3/history/since": shifted("demo/radarr/history-since.json", days),
  "radarr GET /api/v3/release": "demo/radarr/release.json",
  "radarr GET /api/v3/manualimport": "demo/radarr/manualimport.json",
  "radarr GET /api/v3/calendar": shifted("demo/radarr/calendar.json", days),
  "sonarr GET /api/v3/queue": shifted("demo/sonarr/queue.json", days),
  "sonarr GET /api/v3/wanted/missing": "demo/sonarr/wanted-missing.json",
  "sonarr GET /api/v3/history/since": shifted("demo/sonarr/history-since.json", days),
  "sonarr GET /api/v3/release": "demo/sonarr/release.json",
  "sonarr GET /api/v3/manualimport": "demo/sonarr/manualimport.json",
  "sonarr GET /api/v3/episode": "demo/sonarr/episodes.json",
  "sonarr GET /api/v3/calendar": shifted("demo/sonarr/calendar.json", days),
  "reclaimerr GET /api/v1/candidates": shifted("demo/reclaimerr/candidates.json", days),
  // Its deletion task runs at 02:00: next, tomorrow's.
  "reclaimerr GET /api/v1/tasks/delete_cleanup_candidates": {
    json: {
      ...(fixture("demo/reclaimerr/deletion-task.json") as object),
      next_run_at: new Date(recordedDay + (days + 1) * dayMs + 2 * 3600_000).toISOString()
    }
  },
  "seerr GET /api/v1/request": "demo/seerr/requests-pending.json",
  "seerr GET /api/v1/movie/516729": "demo/seerr/movie.json",
  "seerr GET /api/v1/tv/95396": "demo/seerr/tv.json",
  "seerr GET /api/v1/tv/90228": "demo/seerr/tv-second.json",
  "seerr GET /api/v1/search": "demo/seerr/search.json",
  "seerr GET /api/v1/user": "demo/seerr/users.json",
  "seerr POST /api/v1/request": { status: 201, json: fixture("demo/seerr/request-created.json") },
  "cleanuparr GET /api/strikes": shifted("demo/cleanuparr/strikes.json", days),
  "cleanuparr GET /api/configuration/queue_cleaner": "demo/cleanuparr/queue-cleaner.json",
  "cleanuparr GET /api/queue-rules/stall": "demo/cleanuparr/stall-rules.json",
  "cleanuparr GET /api/queue-rules/slow": "demo/cleanuparr/slow-rules.json",
  "cleanuparr GET /api/jobs/QueueCleaner": shifted("demo/cleanuparr/job-queue-cleaner.json", days),
  "cleanuparr GET /api/events": shifted("demo/cleanuparr/events-removed.json", days),
  "cleanuparr GET /api/configuration/download_cleaner": "demo/cleanuparr/download-cleaner.json",
  "cleanuparr GET /api/jobs/DownloadCleaner": shifted("demo/cleanuparr/job-download-cleaner.json", days),
  "radarr GET /api/v3/config/mediamanagement": "demo/radarr/mediamanagement.json",
  "sonarr GET /api/v3/config/mediamanagement": "demo/radarr/mediamanagement.json",
  // Upcoming's finished torrents; the download's progress comes from the watch's snapshots below.
  "qbittorrent GET /api/v2/torrents/info": "demo/qbittorrent/torrents-real.json",
  "jellyfin GET /Items": "demo/jellyfin/items-movie.json",
  "jellyfin GET /Users": "demo/jellyfin/users.json"
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
export const storageHistory = (now: number): ReadonlyArray<readonly [string, unknown]> => {
  const hour = 3600_000
  const end = 759102349312
  const marks = [
    { daysAgo: 33, kind: "arrived", service: "radarr", title: "Sintel", detail: "Imported", bytes: 12e9 },
    {
      daysAgo: 26,
      kind: "arrived",
      service: "sonarr",
      title: "Harbor Lights S02",
      detail: "8 episodes imported",
      bytes: 18e9
    },
    {
      daysAgo: 19,
      kind: "gone",
      service: "reclaimerr",
      title: "Far Shore S07",
      detail: "Deleted",
      bytes: 24e9,
      holds: "shows"
    },
    { daysAgo: 12, kind: "gone", service: "cleanuparr", title: "Big Buck Bunny", detail: "Seed cleanup", bytes: 0 },
    {
      daysAgo: 6,
      kind: "arrived",
      service: "sonarr",
      title: "Paper Lanterns S04",
      detail: "6 episodes imported",
      bytes: 11e9
    },
    {
      daysAgo: 2,
      kind: "gone",
      service: "cleanuparr",
      title: "Northbound S03",
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

/** Something going on: Big Buck Bunny downloading at 42 %. */
export const downloading = (home: FakeHome) =>
  Effect.gen(function*() {
    yield* home.webhook("radarr", fixture("demo/radarr/movie-added.json"))
    yield* home.webhook("radarr", fixture("demo/radarr/grab.json"))
    yield* home.snapshot(torrentsWatchId, (fixture("demo/qbittorrent/torrents-info.json") as Array<object>).slice(0, 1))
  })
