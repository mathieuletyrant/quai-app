import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import { Effect, Layer, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import { QueuePage } from "../../src/integrations/arr.ts"
import {
  cleanuparr,
  completion,
  excluding,
  newRemovals,
  stuckRemovals,
  queuedByDownload,
  type QueueRules,
  removalNote,
  removalsRead,
  removalsWatchId,
  ruleLimit,
  settingsRead,
  slowRulesRead,
  stallRulesRead,
  strikesRead,
  type StruckDownload
} from "../../src/integrations/cleanuparr.ts"
import { Integrations } from "../../src/integrations/Integration.ts"
import { queuedMovie } from "../../src/fixes/movies.ts"
import { Journal } from "../../src/journal/Journal.ts"
import { Apns } from "../../src/push/Apns.ts"
import { cloud, makeFakeHome } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"

const now = Date.parse("2026-11-19T12:00:00Z")
const decode = <A>(read: { readonly schema: Schema.Codec<A, unknown> }, path: string) => Schema.decodeUnknownSync(read.schema)(fixture(path))

const strikes = () => decode(strikesRead, "cleanuparr/strikes.json").items
const settings = () => decode(settingsRead, "cleanuparr/queue-cleaner.json")
const radarrQueue = () => Schema.decodeUnknownSync(QueuePage)(fixture("radarr/queue.json")).records

/** The rules' input, every download in Radarr's queue. */
const input = (downloads: ReadonlyArray<StruckDownload>, overrides: Partial<Parameters<typeof stuckRemovals>[0]> = {}) => ({
  downloads,
  settings: settings(),
  stallRules: decode(stallRulesRead, "cleanuparr/stall-rules.json"),
  slowRules: decode(slowRulesRead, "cleanuparr/slow-rules.json"),
  nextRunAt: undefined,
  queued: (downloadId: string) => {
    const records = radarrQueue().filter((r) => r.downloadId?.toLowerCase() === downloadId.toLowerCase())
    return records.length === 0 ? undefined : { media: queuedMovie(records), records }
  },
  ...overrides
})

const struck = (types: ReadonlyArray<string>, fields: Partial<StruckDownload> = {}): StruckDownload => ({
  downloadItemId: "0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d09",
  downloadId: "C3D4E5F60718293A4B5C6D7E8F90123456789012",
  title: "Mouse.2025.MULTi.1080p.WEB.H264-SUPPLY",
  strikes: types.map((type, i) => ({ type, createdAt: `2026-11-19T11:${String(10 + i * 5)}:00+00:00` })),
  ...fields
})

describe("Cleanuparr: what it removes next", () => {
  it("reads its strikes, settings and rules as Cleanuparr 2.11 answers them", () => {
    expect(strikes().map((d) => [d.title.split(".")[0], d.strikes.length])).toEqual([
      ["The", 2],
      ["Amazing", 2],
      ["Mouse", 1],
      ["Dune", 4],
      ["Night", 2],
      ["Old", 3]
    ])
    // Every setting is kept, the ones Quai doesn't read too: Keep sends them all back.
    expect(settings()).toEqual(fixture("cleanuparr/queue-cleaner.json"))
  })

  it("a stall or slow rule's limit: the enabled rules covering how far it got, the lowest", () => {
    const rule = (maxStrikes: number, min: number, max: number, enabled = true) =>
      ({ enabled, maxStrikes, minCompletionPercentage: min, maxCompletionPercentage: max })
    const rules: QueueRules = [rule(3, 0, 50), rule(5, 50, 100), rule(2, 0, 100, false)]
    expect(ruleLimit(rules, 0)).toBe(3)
    expect(ruleLimit(rules, 50)).toBe(3)
    expect(ruleLimit(rules, 66.7)).toBe(5)
    // How far it got unknown: the soonest any rule removes it.
    expect(ruleLimit(rules, undefined)).toBe(3)
    expect(ruleLimit([rule(4, 20, 100)], 10)).toBe(0)
    expect(ruleLimit([], 10)).toBe(0)
    expect(completion(radarrQueue().slice(0, 1))).toBeCloseTo(66.67, 1)
  })

  it("one strike short of a limit, or at it and marked for removal; dry runs and turned-off checks never count", () => {
    const ids = (downloads: ReadonlyArray<StruckDownload>, overrides = {}) =>
      stuckRemovals(input(downloads, overrides)).map((d) => `${d.fix.removal?.reason} ${d.fix.removal?.strikes}/${d.fix.removal?.maxStrikes}`)
    expect(ids([struck(["Stalled", "Stalled"])])).toEqual(["stalled 2/3"])
    expect(ids([struck(["Stalled"])])).toEqual([])
    expect(ids([struck(["Stalled", "Stalled", "Stalled"])])).toEqual([])
    expect(ids([struck(["Stalled", "Stalled", "Stalled"], { isMarkedForRemoval: true })])).toEqual(["stalled 3/3"])
    expect(ids([struck(["SlowSpeed", "SlowSpeed", "SlowSpeed", "SlowSpeed"])])).toEqual(["slow 4/5"])
    // SlowSpeed and SlowTime are counted apart, as Cleanuparr does.
    expect(ids([struck(["SlowSpeed", "SlowSpeed", "SlowTime", "SlowTime"])])).toEqual([])
    expect(ids([struck(["DownloadingMetadata", "DownloadingMetadata"])])).toEqual(["downloadingMetadata 2/3"])
    // Errored is off in the recorded settings (0 strikes).
    expect(ids([struck(["Errored", "Errored"])])).toEqual([])
    expect(ids([struck(["Stalled", "Stalled"], { strikes: struck(["Stalled", "Stalled"]).strikes.map((s) => ({ ...s, isDryRun: true })) })])).toEqual([])
    expect(ids([struck(["Stalled", "Stalled"], { isRemoved: true })])).toEqual([])
    expect(ids([struck(["DeadTorrent", "DeadTorrent"])])).toEqual([])
    // The closest to its limit wins: one strike left for the import, two for stalling.
    expect(ids([struck(["Stalled", "FailedImport", "FailedImport"])], {})).toEqual(["failedImport 2/3"])
  })

  it("names the *arr's title, Cleanuparr the release; a download no queue has is gone", () => {
    const [mouse] = stuckRemovals(input([struck(["Stalled", "Stalled"])], { nextRunAt: 1_700_000_000 }))
    expect(mouse).toEqual({
      fix: {
        id: "removal-0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d09",
        kind: "stuckRemoval",
        service: "cleanuparr",
        title: "Mouse",
        year: 2025,
        posterUrl: "https://image.tmdb.org/t/p/original/6WYrOc6VZbmBbEhAMuB7vKWd8oY.jpg",
        reason: "Stalled, no progress",
        since: Date.parse("2026-11-19T11:10:00Z") / 1000,
        actions: ["keep", "letGo"],
        removal: { release: "Mouse.2025.MULTi.1080p.WEB.H264-SUPPLY", reason: "stalled", strikes: 2, maxStrikes: 3, removesAt: 1_700_000_000 }
      },
      target: { kind: "removal", downloadItemId: "0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d09", downloadId: "C3D4E5F60718293A4B5C6D7E8F90123456789012" }
    })
    expect(stuckRemovals(input([struck(["Stalled", "Stalled"], { downloadId: "E5F60718293A4B5C6D7E8F9012345678901234AB" })]))).toEqual([])
  })

  it("finds a download in the queues by id, any case, named from all its rows (a season pack has one per episode)", () => {
    const [record] = radarrQueue()
    const queued = queuedByDownload([{ queued: (rows) => ({ title: `${rows.length} rows`, messages: [] }), records: [record!, { ...record!, id: 99 }] }])
    expect(queued(record!.downloadId!.toLowerCase())?.media.title).toBe("2 rows")
    expect(queued("0000000000000000000000000000000000000000")).toBeUndefined()
  })

  it("what the queue cleaner leaves alone, or all of it when it's off, is never planned", () => {
    const mouse = [struck(["Stalled", "Stalled"])]
    expect(stuckRemovals(input(mouse, { settings: { ...settings(), ignoredDownloads: ["c3d4e5f60718293a4b5c6d7e8f90123456789012"] } }))).toEqual([])
    expect(stuckRemovals(input(mouse, { settings: { ...settings(), enabled: false } }))).toEqual([])
  })

  it("keep sends back what Cleanuparr answered, the download added to its ignore list, and passes Quai Home's check", () => {
    const hash = "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
    const recorded = fixture("cleanuparr/queue-cleaner.json") as Record<string, unknown>
    // A field Quai doesn't model, nulls, numbers written as Cleanuparr writes them: all sent back as they came.
    for (const answered of [recorded, { ...recorded, errored: null, ignoredDownloads: null, aFutureSetting: { nested: [1, 2.5] } }]) {
      const body = Option.getOrThrow(excluding(JSON.stringify(answered), hash))
      const before = answered.ignoredDownloads as Array<string> | null
      expect(body).toEqual({ ...answered, ignoredDownloads: [...before ?? [], hash] })
      expect(HomeProtocol.ignoresOneMoreDownload(JSON.parse(JSON.stringify(answered)), JSON.parse(JSON.stringify(body)))).toBe(true)
    }
    // The rules read the same answer, nulls included.
    expect(Schema.decodeUnknownSync(settingsRead.schema)({ ...recorded, errored: null, ignoredDownloads: null })).toMatchObject({ ignoredDownloads: null })
    expect(excluding("<html></html>", hash)).toEqual(Option.none())
    expect(excluding(JSON.stringify({ ...recorded, ignoredDownloads: "x" }), hash)).toEqual(Option.none())
  })

  it("keep is offered only for a download id Quai Home lets into the ignore list; otherwise only let it go", () => {
    const nzbget = "4711"
    const queued = () => ({ media: { title: "Mouse", messages: [] }, records: radarrQueue().slice(2, 3) })
    const [mouse] = stuckRemovals(input([struck(["Stalled", "Stalled"], { downloadId: nzbget })], { queued }))
    expect(mouse?.fix.actions).toEqual(["letGo"])
    expect(stuckRemovals(input([struck(["Stalled", "Stalled"])]))[0]?.fix.actions).toEqual(["keep", "letGo"])
  })
})

describe("Cleanuparr: the journal of its removals", () => {
  const events = () => decode(removalsRead, "cleanuparr/events-removed.json").items

  it("says what it removed and why, never a dry run, oldest first", () => {
    const fresh = newRemovals(events(), Date.parse("2026-11-19T11:00:00Z"), new Set())
    expect(fresh.map(removalNote)).toEqual([
      {
        level: "info",
        source: "cleanuparr",
        kind: "cleanuparr.removed",
        text: "Cleanuparr removed Old.Movie.1999.720p.BluRay.x264-GROUP from the queue (stalled), and from the download client",
        title: "Old.Movie.1999.720p.BluRay.x264-GROUP"
      },
      {
        level: "info",
        source: "cleanuparr",
        kind: "cleanuparr.removed",
        text: "Cleanuparr removed Some.Show.S03E04.1080p.WEB.h264-ETHEL from the queue (its import kept failing)",
        title: "Some.Show.S03E04.1080p.WEB.h264-ETHEL"
      }
    ])
    expect(newRemovals(events(), 0, new Set(events().map((e) => e.id)))).toEqual([])
  })

  const layer = cloud(Layer.effect(Integrations, Effect.map(Effect.service(Journal), (journal) => [cleanuparr(journal)])))
    .pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))
  const removedLines = Effect.map(Effect.flatMap(Effect.service(Journal), (j) => j.since(undefined)), (tail) =>
    tail.entries.filter((e) => e.kind === "cleanuparr.removed").map((e) => e.title))

  it.effect("watched every 5 minutes while Quai Home reaches it; each removal logged once, the last hour's on a first read", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: ["radarr", "cleanuparr"] })
      yield* home.connect
      expect(home.watch(removalsWatchId)).toEqual({ id: removalsWatchId, service: "cleanuparr", path: removalsRead.path, everySeconds: 300 })

      yield* home.snapshot(removalsWatchId, fixture("cleanuparr/events-removed.json"))
      expect(yield* removedLines).toEqual(["Old.Movie.1999.720p.BluRay.x264-GROUP", "Some.Show.S03E04.1080p.WEB.h264-ETHEL"])

      // A later read with one more removal logs only that one.
      const page = fixture("cleanuparr/events-removed.json") as { items: Array<Record<string, unknown>> }
      const later = { ...page.items[0], id: "0195f100-0004-7000-8000-000000000004", timestamp: "2026-11-19T11:59:00+00:00", itemTitle: "Late.Show.S01E01-GRP", deleteReason: "SlowTime" }
      yield* home.snapshot(removalsWatchId, { ...page, items: [later, ...page.items] })
      expect(yield* removedLines).toEqual(["Old.Movie.1999.720p.BluRay.x264-GROUP", "Some.Show.S03E04.1080p.WEB.h264-ETHEL", "Late.Show.S01E01-GRP"])
    }).pipe(Effect.provide(layer)))

  it.effect("a Cloud that starts again goes on from its last removal line in the journal", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services: ["cleanuparr"] })
      // Logged by the Cloud before it restarted, when it read Old Movie's removal.
      home.journal.push({ id: "0001763550000000-c000000", at: Date.parse("2026-11-19T11:25:00Z"), level: "info", source: "cleanuparr", kind: "cleanuparr.removed", text: "…" })
      yield* home.connect
      yield* home.snapshot(removalsWatchId, fixture("cleanuparr/events-removed.json"))
      expect(yield* removedLines).toEqual(["Some.Show.S03E04.1080p.WEB.h264-ETHEL"])
    }).pipe(Effect.provide(layer)))

  it.effect("not reached: not watched", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["radarr"] })
      yield* home.connect
      expect(home.watch(removalsWatchId)).toBeUndefined()
    }).pipe(Effect.provide(layer)))
})
