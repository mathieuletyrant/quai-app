import { describe, expect, it } from "@effect/vitest"
import { defaultAlertSettings } from "@quai/api"
import { Effect, Layer } from "effect"
import type { Activity } from "../../src/flows/Engine.ts"
import { HomeLink } from "../../src/home/HomeLink.ts"
import { HomeReads } from "../../src/home/HomeReads.ts"
import type { WatchContext } from "../../src/integrations/Integration.ts"
import {
  jellyfin,
  libraryUser,
  matchItem,
  playbackEvents,
  playingFrom,
  sessionOf,
  watchIds
} from "../../src/integrations/jellyfin.ts"
import { Journal } from "../../src/journal/Journal.ts"
import { makeFakeHome, recordedHome, testLink } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { download, playback } from "../flows/helpers.ts"

const sessions = [{
  Id: "s1",
  DeviceName: "TV Salon",
  NowPlayingItem: {
    Id: "i1",
    Name: "Who Is Alive?",
    SeriesName: "Severance",
    ParentIndexNumber: 2,
    IndexNumber: 3,
    RunTimeTicks: 36_000_000_000
  },
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
  const items = (...list: ReadonlyArray<{ Id: string; Name: string; ProviderIds: Record<string, string> }>) => ({
    Items: list
  })
  const ourHouse = { _tag: "Episodes" as const, tvdbId: 407046, title: "Our House (2022)", episodes: [] }

  it("finds a title by its id only: another name, another language, a namesake", () => {
    const latest = items(
      { Id: "namesake", Name: "Our House (2022)", ProviderIds: { Tvdb: "1" } },
      { Id: "ours", Name: "Notre maison", ProviderIds: { Tvdb: "407046", Tmdb: "157014" } }
    )
    expect(matchItem(latest, ourHouse)).toBe("ours")
    expect(matchItem(items({ Id: "x", Name: "Our House (2022)", ProviderIds: {} }), ourHouse)).toBeNull()
    expect(
      matchItem(items({ Id: "dune", Name: "Dune : Deuxième partie", ProviderIds: { tmdb: "693134" } }), {
        _tag: "Movie",
        tmdbId: 693134,
        title: "Dune: Part Two"
      })
    ).toBe("dune")
  })

  it("finds a series Jellyfin knows only by TMDB or IMDb (no TVDB without its plugin)", () => {
    const withIds = { ...ourHouse, tmdbId: 157014, imdbId: "tt10098728" }
    expect(matchItem(items({ Id: "tmdb", Name: "Our House", ProviderIds: { Tmdb: "157014" } }), withIds)).toBe("tmdb")
    expect(matchItem(items({ Id: "imdb", Name: "Our House", ProviderIds: { Imdb: "tt10098728" } }), withIds)).toBe(
      "imdb"
    )
    expect(matchItem(items({ Id: "tmdb", Name: "Our House", ProviderIds: { Tmdb: "157014" } }), ourHouse)).toBeNull()
    // A movie and a series may share a TMDB number: each kind is read on its own list.
    expect(matchItem(items({ Id: "other", Name: "Other", ProviderIds: { Tvdb: "157014" } }), withIds)).toBeNull()
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
    expect(first.map((event) => event.type)).toEqual(["playback.started"])
    expect(first[0]!.values).toEqual({ paused: false, detail: "TV Salon", endsAt: 2_401_000, startsAt: -1_199_000 })
    const paused = playbackEvents(new Map(), [{ ...now[0]!, paused: true }], 1_000)
    expect(paused[0]!.values).toEqual({ paused: true, detail: "TV Salon", progress: 1 / 3 })
    const before = new Map(now.map((playing) => [playing.key, playing]))
    expect(playbackEvents(before, now, 2_000).map((event) => event.type)).toEqual(["playback.progress"])
    expect(playbackEvents(before, [], 3_000).map((event) => event.type)).toEqual(["playback.stopped"])
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
  const ctx = (flows: WatchContext["flows"], running: WatchContext["running"]): WatchContext => ({
    flows,
    running,
    services: ["jellyfin"],
    now: 0,
    timeZone: "UTC",
    alerts: defaultAlertSettings
  })

  // Recorded from a real Jellyfin 12.4: users anonymized, the rest as it answered.
  const users = JSON.stringify(fixture("jellyfin/users.json"))
  const admin = "5f2b9c1e8a7d4f3b9e6c0a1d2b3c4e5f"
  const knowUsers = (watcher: NonNullable<Effect.Success<typeof jellyfin>["watcher"]>, context: WatchContext) =>
    Effect.gen(function*() {
      const [usersWatch, before] = watcher.watches(context)
      expect(usersWatch).toEqual({ id: watchIds.users, service: "jellyfin", path: "/Users", everySeconds: 3600 })
      // Until the users are read (a Quai Home too old to read them), the library is listed without one.
      expect(before?.path).not.toContain("userId")
      expect(yield* watcher.read({ watch: usersWatch!, status: 200, body: users }, context)).toEqual([])
    })

  it("lists the library as an administrator: Jellyfin leaves recent titles out without a user", () => {
    expect(libraryUser(fixture("jellyfin/users.json") as never)).toBe(admin)
    expect(libraryUser([{ Id: "off", Policy: { IsAdministrator: true, IsDisabled: true } }, { Id: "viewer" }])).toBe(
      "viewer"
    )
    expect(libraryUser([])).toBeNull()
    const ourHouse = {
      _tag: "Episodes" as const,
      tvdbId: 407046,
      tmdbId: 157014,
      title: "Our House (2022)",
      episodes: []
    }
    // The same Jellyfin, the same minute: 22 series without a user, 29 as the administrator.
    expect(matchItem(fixture("jellyfin/latest-series-no-user.json") as never, ourHouse)).toBeNull()
    expect(matchItem(fixture("jellyfin/latest-series.json") as never, ourHouse)).toBe(
      "1d44f2954a4209050a6e45617780e347"
    )
  })

  it.effect("availability of a movie: the users first, then the latest movies as the administrator, matched by id", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        // "Sœurs de sort" in Jellyfin, whatever Radarr calls it.
        const waiting = activity({ lookup: { _tag: "Movie", tmdbId: 1595124, title: "Sisters of Fate" } })
        expect(watcher.watches(ctx([download], [activity({})]))).toEqual([])
        yield* knowUsers(watcher, ctx([download], [waiting]))
        const [, watch] = watcher.watches(ctx([download], [waiting]))
        expect(watch).toEqual({
          id: watchIds.find("movie:tmdb:1"),
          service: "jellyfin",
          path:
            `/Items?userId=${admin}&Recursive=true&IncludeItemTypes=Movie&SortBy=DateCreated&SortOrder=Descending&Limit=100&Fields=ProviderIds`,
          everySeconds: 15
        })
        expect(
          yield* watcher.read(
            { watch: watch!, status: 200, body: JSON.stringify({ Items: [] }) },
            ctx([download], [waiting])
          )
        ).toEqual([])
        const body = JSON.stringify(fixture("jellyfin/latest-movies.json"))
        const other = activity({ lookup: { _tag: "Movie", tmdbId: 1, title: "Sisters of Fate" } })
        expect(yield* watcher.read({ watch: watch!, status: 200, body }, ctx([download], [other]))).toEqual([])
        const events = yield* watcher.read({ watch: watch!, status: 200, body }, ctx([download], [waiting]))
        expect(events.map((event) => [event.type, event.subject?.key])).toEqual([["media.available", "movie:tmdb:1"]])
      })
    ))

  it.effect("availability of episodes: the series among the latest by id, then its episodes, counted once they have a file", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        const ourHouse = (episodes: Array<{ season: number; episode: number }>) =>
          activity({
            subjectKey: "series:tvdb:407046",
            title: "Our House (2022) · S01",
            lookup: { _tag: "Episodes", tvdbId: 407046, title: "Our House (2022)", episodes }
          })
        const pack = ctx([download], [ourHouse([1, 2, 3, 4].map((episode) => ({ season: 1, episode })))])
        yield* knowUsers(watcher, pack)
        const [, find] = watcher.watches(pack)
        expect(find?.path).toBe(
          `/Items?userId=${admin}&Recursive=true&IncludeItemTypes=Series&SortBy=DateLastContentAdded&SortOrder=Descending&Limit=100&Fields=ProviderIds`
        )
        // Without a user, Jellyfin's answer has no "Notre maison": nothing found.
        expect(
          yield* watcher.read({
            watch: find!,
            status: 200,
            body: JSON.stringify(fixture("jellyfin/latest-series-no-user.json"))
          }, pack)
        ).toEqual([])
        expect(watcher.watches(pack).map((watch) => watch.id)).toEqual([
          watchIds.users,
          watchIds.find("series:tvdb:407046")
        ])
        expect(
          yield* watcher.read({
            watch: find!,
            status: 200,
            body: JSON.stringify(fixture("jellyfin/latest-series.json"))
          }, pack)
        ).toEqual([])
        const [, episodes] = watcher.watches(pack)
        expect(episodes).toMatchObject({
          id: watchIds.episodes("series:tvdb:407046"),
          path:
            `/Items?userId=${admin}&ParentId=1d44f2954a4209050a6e45617780e347&IncludeItemTypes=Episode&Recursive=true&Fields=LocationType`
        })
        const body = JSON.stringify(fixture("jellyfin/episodes-notre-maison.json"))
        expect((yield* watcher.read({ watch: episodes!, status: 200, body }, pack)).map((event) => event.type)).toEqual(
          ["media.available"]
        )
        const later = ctx([download], [ourHouse([{ season: 1, episode: 5 }])])
        expect(yield* watcher.read({ watch: episodes!, status: 200, body }, later)).toEqual([])
      })
    ))

  it.effect("playback: sessions watched only with a playback flow on; started, then position, then stopped", () =>
    withJellyfin((integration) =>
      Effect.gen(function*() {
        const watcher = integration.watcher!
        expect(watcher.watches(ctx([download], []))).toEqual([])
        const [watch] = watcher.watches(ctx([playback], []))
        expect(watch).toEqual({
          id: watchIds.sessions,
          service: "jellyfin",
          path: "/Sessions?ActiveWithinSeconds=120",
          everySeconds: 15
        })
        const read = (body: unknown) =>
          Effect.map(
            watcher.read({ watch: watch!, status: 200, body: JSON.stringify(body) }, ctx([playback], [])),
            (events) => events.map((event) => event.type)
          )
        expect(yield* read(sessions)).toEqual(["playback.started"])
        expect(yield* read(sessions)).toEqual(["playback.progress"])
        expect(yield* read([])).toEqual(["playback.stopped"])
      })
    ))

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
      expect(home.calls.map((call) => [call.method, call.service, call.path])).toEqual([
        ["POST", "jellyfin", "/Sessions/s1/Playing/PlayPause"],
        ["POST", "jellyfin", "/Sessions/s1/Playing/Stop"]
      ])
      expect((yield* Effect.flip(integration.actions["playback.stop"]!(activity({})))).message).toBe("Not a playback.")
      expect(
        (yield* Effect.flip(integration.actions["playback.stop"]!(activity({ subjectKey: "playback:bad:i1" })))).message
      ).toBe("Jellyfin: HTTP 404")
    }).pipe(Effect.provide(link)))
})
