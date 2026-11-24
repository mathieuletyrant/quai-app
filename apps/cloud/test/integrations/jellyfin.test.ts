import { defaultAlertSettings } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { Activity } from "../../src/flows/Engine.ts"
import { HomeLink } from "../../src/home/HomeLink.ts"
import { Journal } from "../../src/journal/Journal.ts"
import { HomeReads } from "../../src/home/HomeReads.ts"
import type { WatchContext } from "../../src/integrations/Integration.ts"
import { jellyfin, matchItem, playbackEvents, playingFrom, sessionOf, watchIds } from "../../src/integrations/jellyfin.ts"
import { makeFakeHome, recordedHome , testLink } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { download, playback } from "../flows/helpers.ts"

const sessions = [{
  Id: "s1",
  DeviceName: "TV Salon",
  NowPlayingItem: { Id: "i1", Name: "Who Is Alive?", SeriesName: "Severance", ParentIndexNumber: 2, IndexNumber: 3, RunTimeTicks: 36_000_000_000 },
  PlayState: { PositionTicks: 12_000_000_000, IsPaused: false }
}, { Id: "idle", DeviceName: "iPad" }]

const activity = (over: Partial<Activity>): Activity => ({
  key: "k",
  flowId: "download",
  subjectKey: "movie:tmdb:1",
  title: "Dune",
  stepIndex: 2,
  tone: "active",
  values: {},
  downloadId: null,
  lookup: null,
  enteredAt: 0,
  movedAt: 0,
  lastEventAt: 0,
  endedAt: null,
  pushedAt: 0,
  pushedFingerprint: null,
  ...over
})

describe("Jellyfin identity", () => {
  const items = (...list: ReadonlyArray<{ Id: string; Name: string; ProviderIds: Record<string, string> }>) => ({ Items: list })
  const ourHouse = { _tag: "Episodes" as const, tvdbId: 407046, title: "Our House (2022)", episodes: [] }

  it("finds a title by its id only: another name, another language, a namesake", () => {
    const latest = items(
      { Id: "namesake", Name: "Our House (2022)", ProviderIds: { Tvdb: "1" } },
      { Id: "ours", Name: "Notre maison", ProviderIds: { Tvdb: "407046", Tmdb: "157014" } }
    )
    expect(matchItem(latest, ourHouse)).toBe("ours")
    expect(matchItem(items({ Id: "x", Name: "Our House (2022)", ProviderIds: {} }), ourHouse)).toBeNull()
    expect(matchItem(items({ Id: "dune", Name: "Dune : Deuxième partie", ProviderIds: { tmdb: "693134" } }), { _tag: "Movie", tmdbId: 693134, title: "Dune: Part Two" })).toBe("dune")
  })
})

describe("Jellyfin sessions", () => {
  it("reads what plays, with position and runtime", () => {
    expect(playingFrom(sessions)).toEqual([{
      key: "playback:s1:i1",
      title: "Severance · S02E03",
      device: "TV Salon",
      paused: false,
      remainingMs: 2_400_000,
      positionMs: 1_200_000,
      runtimeMs: 3_600_000
    }])
  })

  it("started with a timeline, then position, then stopped; paused holds the fraction", () => {
    const now = playingFrom(sessions)
    const first = playbackEvents(new Map(), now, 1_000)
    expect(first.map((e) => e.type)).toEqual(["playback.started"])
    expect(first[0]!.values).toEqual({ paused: false, detail: "TV Salon", endsAt: 2_401_000, startsAt: -1_199_000 })
    const paused = playbackEvents(new Map(), [{ ...now[0]!, paused: true }], 1_000)
    expect(paused[0]!.values).toEqual({ paused: true, detail: "TV Salon", progress: 1 / 3 })
    const before = new Map(now.map((p) => [p.key, p]))
    expect(playbackEvents(before, now, 2_000).map((e) => e.type)).toEqual(["playback.progress"])
    expect(playbackEvents(before, [], 3_000).map((e) => e.type)).toEqual(["playback.stopped"])
  })

  it("reads the session from a playback subject", () => {
    expect(sessionOf("playback:abc:item")).toBe("abc")
    expect(sessionOf("movie:tmdb:1")).toBeNull()
  })
})

const link = HomeReads.layer.pipe(Layer.provideMerge(Journal.layer), Layer.provideMerge(testLink))

describe("Jellyfin integration", () => {
  const withJellyfin = <A, E>(test: (integration: Effect.Success<typeof jellyfin>) => Effect.Effect<A, E, HomeLink>) =>
    Effect.flatMap(jellyfin, test).pipe(Effect.provide(link))
  const ctx = (flows: WatchContext["flows"], running: WatchContext["running"]): WatchContext => ({ flows, running, services: ["jellyfin"], now: 0, timeZone: "UTC", alerts: defaultAlertSettings })

  it.effect("availability of a movie: watched while an activity awaits it with a lookup; available once among the latest by its TMDB id, whatever its name", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        const waiting = activity({ lookup: { _tag: "Movie", tmdbId: 693134, title: "Dune" } })
        expect(watcher.watches(ctx([download], [activity({})]))).toEqual([])
        const [watch] = watcher.watches(ctx([download], [waiting]))
        expect(watch).toEqual({
          id: watchIds.find("movie:tmdb:1"),
          service: "jellyfin",
          path: "/Items?Recursive=true&IncludeItemTypes=Movie&SortBy=DateCreated&SortOrder=Descending&Limit=100&Fields=ProviderIds",
          everySeconds: 15
        })
        expect(yield* watcher.read({ watch: watch!, status: 200, body: JSON.stringify({ Items: [] }) }, ctx([download], [waiting]))).toEqual([])
        const other = activity({ lookup: { _tag: "Movie", tmdbId: 1, title: "Dune" } })
        const body = JSON.stringify(fixture("jellyfin/items-movie.json"))
        expect(yield* watcher.read({ watch: watch!, status: 200, body }, ctx([download], [other]))).toEqual([])
        const events = yield* watcher.read({ watch: watch!, status: 200, body }, ctx([download], [waiting]))
        expect(events.map((e) => [e.type, e.subject?.key])).toEqual([["media.available", "movie:tmdb:1"]])
      })))

  it.effect("availability of episodes: the series by its TVDB id, then its episodes, counted once they have a file", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        const severance = (episodes: Array<{ season: number; episode: number }>) =>
          activity({ subjectKey: "series:tvdb:371980", title: "Severance", lookup: { _tag: "Episodes", tvdbId: 371980, title: "Severance", episodes } })
        const two = ctx([download], [severance([{ season: 2, episode: 1 }, { season: 2, episode: 2 }])])
        const [find] = watcher.watches(two)
        expect(find?.path).toBe("/Items?Recursive=true&IncludeItemTypes=Series&SortBy=DateLastContentAdded&SortOrder=Descending&Limit=100&Fields=ProviderIds")
        expect(yield* watcher.read({ watch: find!, status: 200, body: JSON.stringify(fixture("jellyfin/items-series.json")) }, two)).toEqual([])
        const [episodes] = watcher.watches(two)
        expect(episodes).toMatchObject({
          id: watchIds.episodes("series:tvdb:371980"),
          path: "/Items?ParentId=5e7e7a1c2b3d4f5061728394a5b6c7d8&IncludeItemTypes=Episode&Recursive=true&Fields=LocationType"
        })
        const body = JSON.stringify(fixture("jellyfin/episodes.json"))
        expect((yield* watcher.read({ watch: episodes!, status: 200, body }, two)).map((e) => e.type)).toEqual(["media.available"])
        const third = ctx([download], [severance([{ season: 2, episode: 3 }])])
        expect(yield* watcher.read({ watch: episodes!, status: 200, body }, third)).toEqual([])
      })))

  it.effect("playback: sessions watched only with a playback flow on; started, then position, then stopped", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        expect(watcher.watches(ctx([download], []))).toEqual([])
        const [watch] = watcher.watches(ctx([playback], []))
        expect(watch).toEqual({ id: watchIds.sessions, service: "jellyfin", path: "/Sessions?ActiveWithinSeconds=120", everySeconds: 15 })
        const read = (body: unknown) => Effect.map(watcher.read({ watch: watch!, status: 200, body: JSON.stringify(body) }, ctx([playback], [])), (events) => events.map((e) => e.type))
        expect(yield* read(sessions)).toEqual(["playback.started"])
        expect(yield* read(sessions)).toEqual(["playback.progress"])
        expect(yield* read([])).toEqual(["playback.stopped"])
      })))

  it.effect("its actions are the Jellyfin remote, on the activity's session, as calls through Quai Home", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({
        answer: recordedHome({
          "jellyfin POST /Sessions/s1/Playing/PlayPause": { status: 204 },
          "jellyfin POST /Sessions/s1/Playing/Stop": { status: 204 }
        })
      })
      yield* home.connect
      const integration = yield* jellyfin
      yield* integration.actions["playback.playPause"]!(activity({ subjectKey: "playback:s1:i1" }))
      yield* integration.actions["playback.stop"]!(activity({ subjectKey: "playback:s1:i1" }))
      expect(home.calls.map((c) => [c.method, c.service, c.path])).toEqual([
        ["POST", "jellyfin", "/Sessions/s1/Playing/PlayPause"],
        ["POST", "jellyfin", "/Sessions/s1/Playing/Stop"]
      ])
      expect((yield* Effect.flip(integration.actions["playback.stop"]!(activity({})))).message).toBe("Not a playback.")
      expect((yield* Effect.flip(integration.actions["playback.stop"]!(activity({ subjectKey: "playback:bad:i1" })))).message).toBe("Jellyfin: HTTP 404")
    }).pipe(Effect.provide(link)))
})
