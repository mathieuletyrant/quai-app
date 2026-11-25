import { builtInFlows, defaultAlertSettings, DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { Activities } from "../../src/flows/Activities.ts"
import type { Activity } from "../../src/flows/Engine.ts"
import { FlowStore } from "../../src/flows/FlowStore.ts"
import { attributesFor, contentFor } from "../../src/flows/Targeting.ts"
import { Devices } from "../../src/home/Devices.ts"
import { QueuePage } from "../../src/integrations/arr.ts"
import { Hub } from "../../src/integrations/Hub.ts"
import { RadarrCalendar } from "../../src/integrations/radarr.ts"
import { calendarWatches, calendarWatchIds, dayEvents, pollSeconds } from "../../src/integrations/releases.ts"
import { SonarrCalendar } from "../../src/integrations/sonarr.ts"
import { Apns } from "../../src/push/Apns.ts"
import { apnsBody } from "../../src/push/ApnsPayload.ts"
import { dayOf, dayRange, instantOf, minuteOfDay } from "../../src/home/Day.ts"
import { activityItems, dayReads, dayReleases, startsAt } from "../../src/releases/ReleaseDays.ts"
import { cloudLive, makeFakeHome, recordedHome } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { TestApp, testAppDroppingOn } from "../testApp.ts"

const paris = "Europe/Paris"

/** The calendars and queues of the day, as Quai Home reads them (the route's reads, the watches'). */
const calendars = {
  "sonarr GET /api/v3/calendar": "sonarr/calendar.json",
  "sonarr GET /api/v3/queue": "sonarr/queue-calendar.json",
  "radarr GET /api/v3/calendar": "radarr/calendar.json",
  "radarr GET /api/v3/queue": "radarr/queue-calendar.json"
}
const today = builtInFlows.find((flow) => flow.id === "today")!
const decode = <A, I>(schema: Schema.Codec<A, I>, path: string) => Schema.decodeUnknownSync(schema)(fixture(path))

const inputs = () => ({
  episodes: decode(SonarrCalendar, "sonarr/calendar.json"),
  movies: decode(RadarrCalendar, "radarr/calendar.json"),
  sonarrQueue: decode(QueuePage, "sonarr/queue-calendar.json").records,
  radarrQueue: decode(QueuePage, "radarr/queue-calendar.json").records
})

/** Every episode and movie of the day with its file. */
const allHere = () => ({
  episodes: (fixture("sonarr/calendar.json") as Array<object>).map((episode) => ({ ...episode, hasFile: true })),
  movies: (fixture("radarr/calendar.json") as Array<object>).map((movie) => ({ ...movie, hasFile: true }))
})

describe("the home's day", () => {
  it("reads days and local times in the home's time zone, DST included", () => {
    const evening = Date.parse("2026-11-20T23:30:00Z")
    expect(dayOf(evening, "UTC")).toBe("2026-11-20")
    expect(dayOf(evening, paris)).toBe("2026-11-21")
    expect(minuteOfDay(evening, paris)).toBe(30)
    expect(new Date(instantOf("2026-11-20", "18:00", paris)).toISOString()).toBe("2026-11-20T17:00:00.000Z")
    expect(new Date(instantOf("2026-07-01", "18:00", paris)).toISOString()).toBe("2026-07-01T16:00:00.000Z")
    expect(new Date(instantOf("2026-11-20", "18:00", "America/New_York")).toISOString()).toBe("2026-11-20T23:00:00.000Z")
    const spring = dayRange("2026-03-29", paris)
    expect((spring.end - spring.start) / 3600_000).toBe(23)
    expect(new Date(dayRange("2026-11-20", paris).start).toISOString()).toBe("2026-11-19T23:00:00.000Z")
  })
})

const emptyActivity: Activity = {
  key: "today|day:2026-11-20",
  flowId: "today",
  subjectKey: "day:2026-11-20",
  title: "Today",
  stepIndex: 0,
  tone: "active",
  values: {},
  downloadId: null,
  lookup: null,
  enteredAt: 0,
  movedAt: 0,
  lastEventAt: 0,
  endedAt: null,
  pushedAt: 0,
  pushedFingerprint: null
}

describe("today's releases", () => {
  it("lists the monitored episodes airing today and the movies out today, with where each stands", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(releases.map((release) => [release.id, release.title, release.episode, release.status])).toEqual([
      ["episode:501", "Severance", "S02E10", "available"],
      ["episode:502", "The Bear", "S04E02", "downloading"],
      ["episode:503", "Slow Horses", "S05E03", "missing"],
      ["movie:60", "The Wild Robot", undefined, "grabbed"]
    ])
    // Each points at its title in the Library: the series for an episode, the movie itself.
    expect(releases.map((release) => release.libraryId)).toEqual(["series:3", "series:8", "series:11", "movie:60"])
    expect(releases[0]).toMatchObject({
      kind: "episode",
      episodeTitle: "Cold Harbor",
      airsAt: Date.parse("2026-11-20T19:00:00Z") / 1000,
      posterUrl: "https://image.tmdb.org/t/p/original/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg"
    })
    // "TBA" isn't a title.
    expect(releases[2]!.episodeTitle).toBeUndefined()
    // In New York the day starts 5 hours later: the late episode is still the 20th's.
    expect(dayReleases("2026-11-20", "America/New_York", inputs()).map((release) => release.id)).toContain("episode:505")
  })

  it("shows at most 4 lines, what's still awaited first, short titles", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(activityItems(releases)).toEqual([
      { title: "Severance S02E10", at: Date.parse("2026-11-20T19:00:00Z") / 1000, state: "done" },
      { title: "The Bear S04E02", at: Date.parse("2026-11-20T20:00:00Z") / 1000, state: "active" },
      { title: "Slow Horses S05E03", at: Date.parse("2026-11-20T21:00:00Z") / 1000, state: "waiting" },
      { title: "The Wild Robot", state: "active" }
    ])
    const many = [...releases, ...releases.map((release) => ({ ...release, id: `${release.id}b`, status: "missing" as const }))]
    const lines = activityItems(many)
    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.state !== "done")).toBe(true)
  })

  it("starts at the flow's time, or when the first release airs if that's earlier", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(new Date(startsAt("2026-11-20", paris, undefined, releases)).toISOString()).toBe("2026-11-20T17:00:00.000Z")
    expect(new Date(startsAt("2026-11-20", paris, "21:30", releases)).toISOString()).toBe("2026-11-20T19:00:00.000Z")
    // A release at 03:00 doesn't start it at 03:00 (iOS stops updating it after ~8 h): 3 h early at most.
    const night = [{ ...releases[0]!, airsAt: Date.parse("2026-11-20T02:00:00Z") / 1000 }, ...releases.slice(1)]
    expect(new Date(startsAt("2026-11-20", paris, undefined, night)).toISOString()).toBe("2026-11-20T14:00:00.000Z")
  })

  it("past 4 releases, the lines are cut but the count is the whole day's", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    const many = [...releases, ...releases.map((release) => ({ ...release, id: `${release.id}b` }))]
    const context = { flows: [today], running: [], services: ["sonarr" as const], now: Date.parse("2026-11-20T17:00:00Z"), timeZone: paris, alerts: defaultAlertSettings }
    const [start] = dayEvents(context, many)
    expect(start!.values?.items).toHaveLength(4)
    expect([start!.values?.here, start!.values?.total, start!.values?.detail]).toEqual([2, 8, "2 of 8 here"])
    const activity = { ...emptyActivity, values: start!.values! }
    expect(contentFor(today, activity, { enabled: true, hiddenSteps: [] })).toMatchObject({ here: 2, total: 8 })
  })

  it("fits a Live Activity push well under APNs' 4 KB", () => {
    const releases = dayReleases("2026-11-20", paris, inputs()).map((release) => ({ ...release, title: "A Very Long Series Title That Goes On And On" }))
    const activity: Activity = {
      key: "today|day:2026-11-20",
      flowId: "today",
      subjectKey: "day:2026-11-20",
      title: "Today",
      stepIndex: 0,
      tone: "active",
      values: { items: activityItems(releases), detail: "1 of 4 here" },
      downloadId: null,
      lookup: null,
      enteredAt: 0,
      movedAt: 0,
      lastEventAt: 0,
      endedAt: null,
      pushedAt: 0,
      pushedFingerprint: null
    }
    const preference = { enabled: true, hiddenSteps: [] }
    const content = contentFor(today, activity, preference)!
    expect(content.items).toHaveLength(4)
    const body = apnsBody({ _tag: "Start", token: "t", attributes: attributesFor(today, activity, preference), content }, 0)
    expect(JSON.stringify(body).length).toBeLessThan(2048)
  })
})

describe("Today's releases flow", () => {
  const services = ["radarr", "sonarr"] as const
  const answer = () => recordedHome(calendars)
  const engine = cloudLive.pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))
  const day = Effect.gen(function*() {
    return [...(yield* (yield* Activities).snapshot).activities.values()].filter((activity) => activity.flowId === "today")
  })
  const pairParis = Effect.gen(function*() {
    const devices = yield* Devices
    const { code } = yield* devices.createPairingCode
    yield* devices.pair({ code, name: "iPhone", apnsEnvironment: "development", timeZone: paris })
  })

  it("the Today tile and the day flows read the same GETs: the watches are the day's reads", () => {
    const context = { flows: [today], running: [], services: ["radarr", "sonarr"] as const, now: Date.parse("2026-11-20T12:00:00Z"), timeZone: paris, alerts: defaultAlertSettings }
    const watched = calendarWatches({ ...context, services: [...context.services] }).map((watch) => `${watch.service} ${watch.path}`)
    expect(watched.sort()).toEqual(Object.values(dayReads("2026-11-20", paris)).map((read) => `${read.service} ${read.path}`).sort())
  })

  it.effect("watches the calendars of the home's day, starts at 18:00, ticks off what arrives, ends when all are here", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T12:00:00Z"))
      const home = yield* makeFakeHome({ services, answer: answer() })
      yield* home.connect
      yield* pairParis
      const hub = yield* Hub
      yield* hub.beat
      const episodes = home.watch(calendarWatchIds.episodes)!
      expect(episodes.path).toBe(
        "/api/v3/calendar?start=2026-11-19T23%3A00%3A00.000Z&end=2026-11-20T23%3A00%3A00.000Z&unmonitored=false&includeSeries=true"
      )
      expect(episodes.everySeconds).toBe(pollSeconds.idle)
      for (const id of Object.values(calendarWatchIds)) {
        const watch = home.watch(id)!
        yield* home.snapshot(id, fixture(`${watch.service}/${id.endsWith("queue") ? "queue-calendar" : "calendar"}.json`))
      }
      // 13:00 in Paris: not yet.
      expect(yield* day).toEqual([])

      yield* TestClock.setTime(Date.parse("2026-11-20T17:00:00Z"))
      yield* hub.beat
      const [started] = yield* day
      expect(started).toMatchObject({ subjectKey: "day:2026-11-20", stepIndex: 0, values: { detail: "1 of 4 here", here: 1, total: 4 } })
      expect(started!.values.items?.map((item) => item.state)).toEqual(["done", "active", "waiting", "active"])
      // While it runs, every 5 minutes.
      expect(home.watch(calendarWatchIds.episodes)!.everySeconds).toBe(pollSeconds.running)
      // A heartbeat with nothing new writes nothing.
      const writes = home.received.filter((message) => message._tag === "StorePut").length
      yield* hub.beat
      expect(home.received.filter((message) => message._tag === "StorePut").length).toBe(writes)

      // Everything has its file: All here, and the end.
      yield* home.snapshot(calendarWatchIds.episodes, allHere().episodes)
      yield* home.snapshot(calendarWatchIds.movies, allHere().movies)
      const [ended] = yield* day
      expect(ended).toMatchObject({ stepIndex: 1, tone: "done", values: { detail: "4 of 4 here" } })
      expect(ended!.endedAt).not.toBeNull()
      // Never a download: only reads.
      expect(home.calls.filter((call) => call.method !== "GET")).toEqual([])
    }).pipe(Effect.provide(engine)))

  it.effect("starts with the first release when it airs before the flow's time, and ends at midnight", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T18:30:00Z"))
      const home = yield* makeFakeHome({ services, answer: answer() })
      yield* home.connect
      yield* pairParis
      yield* (yield* FlowStore).save({ ...today, filter: { startsAt: "21:30" } })
      const hub = yield* Hub
      yield* hub.beat
      for (const id of Object.values(calendarWatchIds)) {
        const watch = home.watch(id)!
        yield* home.snapshot(id, fixture(`${watch.service}/${id.endsWith("queue") ? "queue-calendar" : "calendar"}.json`))
      }
      expect(yield* day).toEqual([])
      // 20:00 in Paris: Severance airs, before 21:30.
      yield* TestClock.setTime(Date.parse("2026-11-20T19:00:00Z"))
      yield* hub.beat
      expect((yield* day).map((activity) => activity.stepIndex)).toEqual([0])

      // Midnight in Paris: the day is over, where it was.
      yield* TestClock.setTime(Date.parse("2026-11-20T23:00:00Z"))
      yield* hub.beat
      const [over] = yield* day
      expect(over).toMatchObject({ subjectKey: "day:2026-11-20", stepIndex: 0, tone: "done" })
      expect(over!.endedAt).not.toBeNull()
      // The new day's calendars are watched; yesterday's reads don't start anything today.
      expect(home.watch(calendarWatchIds.episodes)!.path).toContain("start=2026-11-20T23%3A00%3A00.000Z")
      expect((yield* day).filter((activity) => activity.endedAt === null)).toEqual([])
    }).pipe(Effect.provide(engine)))

  it.effect("a release at 03:00 starts it at 15:00 at the earliest, not in the night", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T01:00:00Z"))
      const home = yield* makeFakeHome({ services, answer: answer() })
      yield* home.connect
      yield* pairParis
      const hub = yield* Hub
      yield* hub.beat
      const early = (fixture("sonarr/calendar.json") as Array<{ airDateUtc: string }>).map((episode, index) => index === 1 ? { ...episode, airDateUtc: "2026-11-20T02:00:00Z" } : episode)
      yield* home.snapshot(calendarWatchIds.episodes, early)
      yield* TestClock.setTime(Date.parse("2026-11-20T02:00:00Z"))
      yield* hub.beat
      expect(yield* day).toEqual([])
      yield* TestClock.setTime(Date.parse("2026-11-20T13:59:00Z"))
      yield* hub.beat
      expect(yield* day).toEqual([])
      yield* TestClock.setTime(Date.parse("2026-11-20T14:00:00Z"))
      yield* hub.beat
      expect((yield* day).map((activity) => activity.enteredAt)).toEqual([Date.parse("2026-11-20T14:00:00Z")])
    }).pipe(Effect.provide(engine)))

  it.effect("starts nothing when everything is already here", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T17:00:00Z"))
      const home = yield* makeFakeHome({ services, answer: answer() })
      yield* home.connect
      yield* pairParis
      yield* (yield* Hub).beat
      yield* home.snapshot(calendarWatchIds.episodes, allHere().episodes)
      yield* home.snapshot(calendarWatchIds.movies, allHere().movies)
      yield* (yield* Hub).beat
      expect(yield* day).toEqual([])
    }).pipe(Effect.provide(engine)))
})

describe("the home's time zone", () => {
  it.effect("an iPhone that reports a time zone that doesn't exist is ignored: UTC", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T23:30:00Z"))
      const home = yield* makeFakeHome({ services: ["sonarr"], answer: () => ({ json: [] }) })
      yield* home.connect
      const devices = yield* Devices
      const { code } = yield* devices.createPairingCode
      yield* devices.pair({ code, name: "iPhone", apnsEnvironment: "development", timeZone: "Mars/Olympus" })
      expect(Option.isNone(yield* devices.timeZone)).toBe(true)
    }).pipe(Effect.provide(TestApp)))
})
