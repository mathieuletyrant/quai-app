import { builtInFlows, DeviceAuth, QuaiApi } from "@quai/api"
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
import { calendarWatchIds, dayEvents, pollSeconds } from "../../src/integrations/releases.ts"
import { SonarrCalendar } from "../../src/integrations/sonarr.ts"
import { Apns } from "../../src/push/Apns.ts"
import { apnsBody } from "../../src/push/ApnsPayload.ts"
import { dayOf, dayRange, instantOf, minuteOfDay } from "../../src/releases/Day.ts"
import { activityItems, dayReleases, startsAt } from "../../src/releases/Tonight.ts"
import { cloudLive, type FakeHomeOptions, makeFakeHome } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { TestApp } from "../testApp.ts"

const paris = "Europe/Paris"
const tonight = builtInFlows.find((f) => f.id === "tonight")!
const decode = <A, I>(schema: Schema.Codec<A, I>, path: string) => Schema.decodeUnknownSync(schema)(fixture(path))

const inputs = () => ({
  episodes: decode(SonarrCalendar, "sonarr/calendar.json"),
  movies: decode(RadarrCalendar, "radarr/calendar.json"),
  sonarrQueue: decode(QueuePage, "sonarr/queue-calendar.json").records,
  radarrQueue: decode(QueuePage, "radarr/queue-calendar.json").records
})

/** Every episode and movie of the day with its file. */
const allHere = () => ({
  episodes: (fixture("sonarr/calendar.json") as Array<object>).map((e) => ({ ...e, hasFile: true })),
  movies: (fixture("radarr/calendar.json") as Array<object>).map((m) => ({ ...m, hasFile: true }))
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
  key: "tonight|day:2026-11-20",
  flowId: "tonight",
  subjectKey: "day:2026-11-20",
  title: "Tonight",
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

describe("tonight's releases", () => {
  it("lists the monitored episodes airing today and the movies out today, with where each stands", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(releases.map((r) => [r.id, r.title, r.episode, r.status])).toEqual([
      ["episode:501", "Severance", "S02E10", "available"],
      ["episode:502", "The Bear", "S04E02", "downloading"],
      ["episode:503", "Slow Horses", "S05E03", "missing"],
      ["movie:60", "The Wild Robot", undefined, "grabbed"]
    ])
    expect(releases[0]).toMatchObject({
      kind: "episode",
      episodeTitle: "Cold Harbor",
      airsAt: Date.parse("2026-11-20T19:00:00Z") / 1000,
      posterUrl: "https://artworks.thetvdb.com/banners/posters/371980-1.jpg"
    })
    // "TBA" isn't a title.
    expect(releases[2]!.episodeTitle).toBeUndefined()
    // In New York the day starts 5 hours later: the late episode is still the 20th's.
    expect(dayReleases("2026-11-20", "America/New_York", inputs()).map((r) => r.id)).toContain("episode:505")
  })

  it("shows at most 4 lines, what's still awaited first, short titles", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(activityItems(releases)).toEqual([
      { title: "Severance S02E10", at: Date.parse("2026-11-20T19:00:00Z") / 1000, state: "done" },
      { title: "The Bear S04E02", at: Date.parse("2026-11-20T20:00:00Z") / 1000, state: "active" },
      { title: "Slow Horses S05E03", at: Date.parse("2026-11-20T21:00:00Z") / 1000, state: "waiting" },
      { title: "The Wild Robot", state: "active" }
    ])
    const many = [...releases, ...releases.map((r) => ({ ...r, id: `${r.id}b`, status: "missing" as const }))]
    const lines = activityItems(many)
    expect(lines).toHaveLength(4)
    expect(lines.every((l) => l.state !== "done")).toBe(true)
  })

  it("starts at the flow's time, or when the first release airs if that's earlier", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    expect(new Date(startsAt("2026-11-20", paris, undefined, releases)).toISOString()).toBe("2026-11-20T17:00:00.000Z")
    expect(new Date(startsAt("2026-11-20", paris, "21:30", releases)).toISOString()).toBe("2026-11-20T19:00:00.000Z")
  })

  it("past 4 releases, the lines are cut but the count is the whole day's", () => {
    const releases = dayReleases("2026-11-20", paris, inputs())
    const many = [...releases, ...releases.map((r) => ({ ...r, id: `${r.id}b` }))]
    const context = { flows: [tonight], running: [], services: ["sonarr" as const], now: Date.parse("2026-11-20T17:00:00Z"), timeZone: paris }
    const [start] = dayEvents(context, many)
    expect(start!.values?.items).toHaveLength(4)
    expect([start!.values?.here, start!.values?.total, start!.values?.detail]).toEqual([2, 8, "2 of 8 here"])
    const activity = { ...emptyActivity, values: start!.values! }
    expect(contentFor(tonight, activity, { enabled: true, hiddenSteps: [] })).toMatchObject({ here: 2, total: 8 })
  })

  it("fits a Live Activity push well under APNs' 4 KB", () => {
    const releases = dayReleases("2026-11-20", paris, inputs()).map((r) => ({ ...r, title: "A Very Long Series Title That Goes On And On" }))
    const activity: Activity = {
      key: "tonight|day:2026-11-20",
      flowId: "tonight",
      subjectKey: "day:2026-11-20",
      title: "Tonight",
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
    const content = contentFor(tonight, activity, preference)!
    expect(content.items).toHaveLength(4)
    const body = apnsBody({ _tag: "Start", token: "t", attributes: attributesFor(tonight, activity, preference), content }, 0)
    expect(JSON.stringify(body).length).toBeLessThan(2048)
  })
})

describe("Tonight's releases flow", () => {
  const services = ["radarr", "sonarr"] as const
  /** Quai Home answering from the recordings, calls included (the route's reads). */
  const answer = (): NonNullable<FakeHomeOptions["answer"]> => (call) => {
    const path = call.path.split("?")[0]
    if (path === "/api/v3/calendar") return { json: fixture(`${call.service}/calendar.json`) }
    if (path === "/api/v3/queue") return { json: fixture(`${call.service}/queue-calendar.json`) }
    return { status: 404 }
  }
  const engine = cloudLive.pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))
  const day = Effect.gen(function*() {
    return [...(yield* (yield* Activities).snapshot).activities.values()].filter((a) => a.flowId === "tonight")
  })
  const pairParis = Effect.gen(function*() {
    const devices = yield* Devices
    const { code } = yield* devices.createPairingCode
    yield* devices.pair({ code, name: "iPhone", apnsEnvironment: "development", timeZone: paris })
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
      expect(started!.values.items?.map((i) => i.state)).toEqual(["done", "active", "waiting", "active"])
      // While it runs, every 5 minutes.
      expect(home.watch(calendarWatchIds.episodes)!.everySeconds).toBe(pollSeconds.running)
      // A heartbeat with nothing new writes nothing.
      const writes = home.received.filter((m) => m._tag === "StorePut").length
      yield* hub.beat
      expect(home.received.filter((m) => m._tag === "StorePut").length).toBe(writes)

      // Everything has its file: All here, and the end.
      yield* home.snapshot(calendarWatchIds.episodes, allHere().episodes)
      yield* home.snapshot(calendarWatchIds.movies, allHere().movies)
      const [ended] = yield* day
      expect(ended).toMatchObject({ stepIndex: 1, tone: "done", values: { detail: "4 of 4 here" } })
      expect(ended!.endedAt).not.toBeNull()
      // Never a download: only reads.
      expect(home.calls.filter((c) => c.method !== "GET")).toEqual([])
    }).pipe(Effect.provide(engine)))

  it.effect("starts with the first release when it airs before the flow's time, and ends at midnight", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T18:30:00Z"))
      const home = yield* makeFakeHome({ services, answer: answer() })
      yield* home.connect
      yield* pairParis
      yield* (yield* FlowStore).save({ ...tonight, filter: { startsAt: "21:30" } })
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
      expect((yield* day).map((a) => a.stepIndex)).toEqual([0])

      // Midnight in Paris: the day is over, where it was.
      yield* TestClock.setTime(Date.parse("2026-11-20T23:00:00Z"))
      yield* hub.beat
      const [over] = yield* day
      expect(over).toMatchObject({ subjectKey: "day:2026-11-20", stepIndex: 0, tone: "done" })
      expect(over!.endedAt).not.toBeNull()
      // The new day's calendars are watched; yesterday's reads don't start anything today.
      expect(home.watch(calendarWatchIds.episodes)!.path).toContain("start=2026-11-20T23%3A00%3A00.000Z")
      expect((yield* day).filter((a) => a.endedAt === null)).toEqual([])
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

describe("releases route", () => {
  it.effect("lists today's releases in the iPhone's time zone", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(Date.parse("2026-11-20T12:00:00Z"))
      const home = yield* makeFakeHome({
        services: ["radarr", "sonarr"],
        answer: (call) => {
          const path = call.path.split("?")[0]
          if (path === "/api/v3/calendar") return { json: fixture(`${call.service}/calendar.json`) }
          if (path === "/api/v3/queue") return { json: fixture(`${call.service}/queue-calendar.json`) }
          return { status: 404 }
        }
      })
      yield* home.connect
      const console = yield* HttpApiTest.groups(QuaiApi, ["console"])
      const qr = yield* console.console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { name: "iPhone", apnsEnvironment: "development", code: qr.code, timeZone: paris }
      })
      const api = yield* HttpApiTest.groups(QuaiApi, ["releases"]).pipe(
        Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
      )
      const today = yield* api.releases.today()
      expect(today.day).toBe("2026-11-20")
      expect(today.timeZone).toBe(paris)
      expect(today.unavailable).toEqual([])
      expect(today.items.map((r) => r.status)).toEqual(["available", "downloading", "missing", "grabbed"])
    }).pipe(Effect.provide(TestApp)))

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
