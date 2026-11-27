import { describe, expect, it } from "@effect/vitest"
import { HomeOffline } from "@quai/api"
import { offlineMessage } from "@quai/domain/home/HomeLink.ts"
import {
  answerKeptMs,
  AnswersKeptFor,
  HomeReads,
  makeKeptGets,
  screenAnswerKeptMs
} from "@quai/domain/home/HomeReads.ts"
import { Journal } from "@quai/domain/journal/Journal.ts"
import { Effect, Fiber, Layer, Logger, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import { type Answer, makeFakeHome, recordedHome, type Recording, settle, testLink } from "../fakeHome.ts"

const Status = Schema.Struct({ version: Schema.String })
const status = { service: "radarr", path: "/api/v3/system/status?secret=x", schema: Status } as const
const route = "radarr GET /api/v3/system/status"

const logs: Array<string> = []
const captured = Logger.layer([Logger.make(({ logLevel, message }) => {
  if (logLevel === "Warn") logs.push((Array.isArray(message) ? message : [message]).map(String).join(" "))
})])
const reads = HomeReads.layer.pipe(
  Layer.provideMerge(Journal.layer),
  Layer.provideMerge(testLink),
  Layer.provideMerge(captured)
)

/** A home whose status route answers `answer`; not strict, so a refusal can be the answer. */
const homeAnswering = (answer: Exclude<Recording, string>) =>
  Effect.gen(function*() {
    logs.length = 0
    const home = yield* makeFakeHome({
      strict: false,
      services: ["radarr", "sonarr"],
      answer: recordedHome({ [route]: answer })
    })
    yield* home.connect
    return home
  })

describe("HomeReads.read", () => {
  it.effect("is the decoded body of a 2xx answer", () =>
    Effect.gen(function*() {
      yield* homeAnswering({ json: { version: "5.2" } })
      expect(yield* (yield* HomeReads).read(status)).toEqual(Option.some({ version: "5.2" }))
      expect(logs).toEqual([])
    }).pipe(Effect.provide(reads)))

  const nones: ReadonlyArray<readonly [string, Answer, string]> = [
    ["a 404", { status: 404, body: "Not Found" }, "radarr /api/v3/system/status: HTTP 404"],
    [
      "a 500",
      { status: 500, json: { message: "Database is locked, The Godfather" } },
      "radarr /api/v3/system/status: HTTP 500"
    ],
    [
      "a body that isn't JSON",
      { body: "<html>The Godfather</html>" },
      "radarr /api/v3/system/status: an answer Quai can't read"
    ],
    [
      "a body of another shape",
      { json: { title: "The Godfather" } },
      "radarr /api/v3/system/status: an answer Quai can't read"
    ],
    [
      "a call Quai Home couldn't make",
      { failed: "radarr is unreachable" },
      "radarr /api/v3/system/status: radarr is unreachable"
    ]
  ]
  for (const [what, answer, log] of nones) {
    it.effect(`is None on ${what}, logged once with the service and path, never the body`, () =>
      Effect.gen(function*() {
        yield* homeAnswering(answer)
        expect(yield* (yield* HomeReads).read(status)).toEqual(Option.none())
        expect(logs).toEqual([log])
      }).pipe(Effect.provide(reads)))
  }

  it.effect("is None on a call the allowlist refuses", () =>
    Effect.gen(function*() {
      const home = yield* homeAnswering({ json: {} })
      expect(yield* (yield* HomeReads).read({ ...status, path: "/api/v3/config/host" })).toEqual(Option.none())
      expect(home.notAllowed).toEqual(["radarr GET /api/v3/config/host"])
      expect(logs).toEqual(["radarr /api/v3/config/host: not allowed"])
    }).pipe(Effect.provide(reads)))

  it.effect("is None when Quai Home doesn't answer in time", () =>
    Effect.gen(function*() {
      yield* homeAnswering({ silent: true })
      const read = yield* Effect.forkChild((yield* HomeReads).read(status))
      yield* settle
      yield* TestClock.adjust("15 seconds")
      expect(yield* Fiber.join(read)).toEqual(Option.none())
      expect(logs).toEqual(["radarr /api/v3/system/status: Quai Home didn't answer in time"])
    }).pipe(Effect.provide(reads)))

  it.effect("a 404 can mean something: what the read says it is", () =>
    Effect.gen(function*() {
      yield* homeAnswering({ status: 404, json: { message: "Not found" } })
      expect(yield* (yield* HomeReads).read({ ...status, notFound: { version: "gone" } })).toEqual(
        Option.some({ version: "gone" })
      )
    }).pipe(Effect.provide(reads)))

  it.effect("fails HomeOffline when Quai Home drops during the read, or isn't there", () =>
    Effect.gen(function*() {
      const offline = new HomeOffline({ message: offlineMessage })
      yield* homeAnswering({ drop: true })
      const homeReads = yield* HomeReads
      expect(yield* Effect.flip(homeReads.read(status))).toEqual(offline)
      expect(yield* Effect.flip(homeReads.read(status))).toEqual(offline)
      expect(yield* Effect.flip(homeReads.all({ status }))).toEqual(offline)
    }).pipe(Effect.provide(reads)))
})

describe("HomeReads, the same GET read again", () => {
  /** The GETs of the status route the home was asked. */
  const statusCalls = (home: { readonly calls: ReadonlyArray<{ readonly path: string }> }) =>
    home.calls.filter((call) => call.path === status.path).length

  it.effect("read at once, it's one call that answers every read", () =>
    Effect.gen(function*() {
      const home = yield* homeAnswering({ json: { version: "5.2" } })
      const homeReads = yield* HomeReads
      const values = yield* Effect.all([homeReads.read(status), homeReads.read(status), homeReads.read(status)], {
        concurrency: "unbounded"
      })
      expect(values).toEqual([
        Option.some({ version: "5.2" }),
        Option.some({ version: "5.2" }),
        Option.some({ version: "5.2" })
      ])
      expect(statusCalls(home)).toBe(1)
    }).pipe(Effect.provide(reads)))

  it.effect("its 2xx answer serves the reads for a few seconds, then it's asked again", () =>
    Effect.gen(function*() {
      let version = "5.2"
      const home = yield* homeAnswering(() => ({ json: { version } }))
      const homeReads = yield* HomeReads
      expect(yield* homeReads.read(status)).toEqual(Option.some({ version: "5.2" }))
      version = "5.3"
      yield* TestClock.adjust(answerKeptMs - 1)
      expect(yield* homeReads.read(status)).toEqual(Option.some({ version: "5.2" }))
      expect(statusCalls(home)).toBe(1)
      yield* TestClock.adjust(1)
      expect(yield* homeReads.read(status)).toEqual(Option.some({ version: "5.3" }))
      expect(statusCalls(home)).toBe(2)
    }).pipe(Effect.provide(reads)))

  it.effect("another query is another GET", () =>
    Effect.gen(function*() {
      const home = yield* homeAnswering({ json: { version: "5.2" } })
      const homeReads = yield* HomeReads
      yield* homeReads.read(status)
      yield* homeReads.read({ ...status, path: "/api/v3/system/status?secret=y" })
      expect(home.calls).toHaveLength(2)
    }).pipe(Effect.provide(reads)))

  const unkept: ReadonlyArray<readonly [string, Answer]> = [
    ["a 500", { status: 500, body: "" }],
    ["a 404", { status: 404, body: "" }],
    ["a call Quai Home couldn't make", { failed: "radarr is unreachable" }]
  ]
  for (const [what, answer] of unkept) {
    it.effect(`${what} isn't kept: the next read asks again`, () =>
      Effect.gen(function*() {
        const home = yield* homeAnswering(answer)
        const homeReads = yield* HomeReads
        yield* homeReads.read(status)
        yield* homeReads.read(status)
        expect(statusCalls(home)).toBe(2)
      }).pipe(Effect.provide(reads)))
  }

  it.effect("Quai Home gone isn't kept: back, it's asked again", () =>
    Effect.gen(function*() {
      let answer: Answer = { drop: true }
      const home = yield* homeAnswering(() => answer)
      const homeReads = yield* HomeReads
      expect((yield* Effect.flip(homeReads.read(status)))._tag).toBe("HomeOffline")
      answer = { json: { version: "5.2" } }
      yield* home.connect
      expect(yield* homeReads.read(status)).toEqual(Option.some({ version: "5.2" }))
    }).pipe(Effect.provide(reads)))

  it.effect("serves a reader for as long as that reader allows: a screen a minute, anything else a few seconds", () =>
    Effect.gen(function*() {
      let version = "5.2"
      const home = yield* homeAnswering(() => ({ json: { version } }))
      const homeReads = yield* HomeReads
      const screen = Effect.provideService(homeReads.read(status), AnswersKeptFor, screenAnswerKeptMs)
      expect(yield* screen).toEqual(Option.some({ version: "5.2" }))
      version = "5.3"
      yield* TestClock.adjust(screenAnswerKeptMs - 1)
      // Nearly a minute old: fine for a screen.
      expect(yield* screen).toEqual(Option.some({ version: "5.2" }))
      expect(statusCalls(home)).toBe(1)
      // Too old for what acts on it: read again, and the screen then has the new answer too.
      expect(yield* homeReads.read(status)).toEqual(Option.some({ version: "5.3" }))
      expect(yield* screen).toEqual(Option.some({ version: "5.3" }))
      expect(statusCalls(home)).toBe(2)
      version = "5.4"
      yield* TestClock.adjust(screenAnswerKeptMs)
      expect(yield* screen).toEqual(Option.some({ version: "5.4" }))
      expect(statusCalls(home)).toBe(3)
    }).pipe(Effect.provide(reads)))

  it.effect("forgets a service's answers when it says something changed, and only that service's", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({
        strict: false,
        services: ["radarr", "sonarr"],
        answer: () => ({ json: { version: "5" } })
      })
      yield* home.connect
      const homeReads = yield* HomeReads
      const sonarr = { ...status, service: "sonarr" } as const
      const screen = <A>(read: Effect.Effect<A, HomeOffline>) =>
        Effect.provideService(read, AnswersKeptFor, screenAnswerKeptMs)
      yield* screen(homeReads.all({ radarr: status, sonarr }))
      yield* homeReads.forget("radarr")
      yield* screen(homeReads.all({ radarr: status, sonarr }))
      expect(home.calls.map((call) => call.service)).toEqual(["radarr", "sonarr", "radarr"])
    }).pipe(Effect.provide(reads)))

  it.effect("a write forgets what was kept: what it changed is read again", () =>
    Effect.gen(function*() {
      const home = yield* homeAnswering({ json: { version: "5.2" } })
      const homeReads = yield* HomeReads
      yield* homeReads.read(status)
      const grab = {
        service: "radarr",
        method: "POST",
        path: "/api/v3/release",
        body: { guid: "g", indexerId: 1 }
      } as const
      yield* Effect.ignore(homeReads.write(grab, (message) => message))
      yield* homeReads.read(status)
      expect(statusCalls(home)).toBe(2)
    }).pipe(Effect.provide(reads)))

  it.effect("a read given up leaves the call to the others", () =>
    Effect.gen(function*() {
      const home = yield* homeAnswering({ silent: true })
      const homeReads = yield* HomeReads
      const given = yield* Effect.forkChild(homeReads.read(status))
      const waiting = yield* Effect.forkChild(homeReads.read(status))
      yield* settle
      yield* Fiber.interrupt(given)
      yield* TestClock.adjust("15 seconds")
      expect(yield* Fiber.join(waiting)).toEqual(Option.none())
      expect(logs).toEqual(["radarr /api/v3/system/status: Quai Home didn't answer in time"])
      expect(statusCalls(home)).toBe(1)
    }).pipe(Effect.provide(reads)))
})

describe("HomeReads.all", () => {
  it.effect("skips what isn't asked or isn't reached; unavailable: the services reached that didn't answer", () =>
    Effect.gen(function*() {
      logs.length = 0
      const home = yield* makeFakeHome({
        services: ["radarr", "sonarr"],
        answer: recordedHome({
          [route]: { json: { version: "5" } },
          "radarr GET /api/v3/diskspace": { status: 500 },
          "sonarr GET /api/v3/system/status": { failed: "unreachable" }
        })
      })
      yield* home.connect
      const { values, unavailable } = yield* (yield* HomeReads).all({
        radarr: status,
        radarrDisk: { service: "radarr", path: "/api/v3/diskspace", schema: Schema.Unknown },
        sonarr: { ...status, service: "sonarr" },
        jellyfin: { service: "jellyfin", path: "/System/Info/Public", schema: Schema.Unknown },
        skipped: null
      }, { optional: ["radarrDisk"] })
      expect(values).toEqual({
        radarr: Option.some({ version: "5" }),
        radarrDisk: Option.none(),
        sonarr: Option.none(),
        jellyfin: Option.none(),
        skipped: Option.none()
      })
      expect(unavailable).toEqual(["sonarr"])
      expect(home.calls.map((call) => call.service).sort()).toEqual(["radarr", "radarr", "sonarr"])
    }).pipe(Effect.provide(reads)))
})

describe("HomeReads.write", () => {
  const refused = (message: string) => ({ _tag: "Refused" as const, message })
  const grab = {
    service: "radarr",
    method: "POST",
    path: "/api/v3/release",
    body: { guid: "g", indexerId: 1 }
  } as const

  it.effect("is the body of a 2xx; otherwise refused, in the service's words or Quai Home's", () =>
    Effect.gen(function*() {
      let answer: Answer = { status: 201, body: "ok" }
      const home = yield* makeFakeHome({ answer: () => answer })
      yield* home.connect
      const write = (yield* HomeReads).write
      expect(yield* write(grab, refused)).toBe("ok")
      answer = { status: 400, json: [{ errorMessage: "Release not found" }] }
      expect(yield* Effect.flip(write(grab, refused))).toEqual(refused("Release not found"))
      answer = { status: 502, body: "" }
      expect(yield* Effect.flip(write(grab, refused))).toEqual(refused("HTTP 502"))
      answer = { failed: "radarr is not configured" }
      expect(yield* Effect.flip(write(grab, refused))).toEqual(refused("Quai Home: radarr is not configured"))
      answer = { drop: true }
      expect(yield* Effect.flip(write(grab, refused))).toEqual(new HomeOffline({ message: offlineMessage }))
    }).pipe(Effect.provide(reads)))
})

describe("the answers kept", () => {
  const now = 1_000_000

  it("serve a GET on its way to every reader, then its answer to those that find it recent enough", () => {
    const gets = makeKeptGets<string>(60_000)
    expect(gets.find("radarr", "/movie", now, 5_000)).toBeUndefined()
    const settle = gets.begin("radarr", "/movie", "answer", now)
    // On its way: whatever the reader allows, it waits for this one.
    expect(gets.find("radarr", "/movie", now + 90_000, 0)).toBe("answer")
    settle(now + 100, true)
    expect(gets.find("radarr", "/movie", now + 5_099, 5_000)).toBe("answer")
    expect(gets.find("radarr", "/movie", now + 5_100, 5_000)).toBeUndefined()
    expect(gets.find("radarr", "/movie", now + 5_100, 60_000)).toBe("answer")
    // Another service, another path: another GET.
    expect(gets.find("sonarr", "/movie", now + 200, 60_000)).toBeUndefined()
    expect(gets.find("radarr", "/movie?tmdbId=1", now + 200, 60_000)).toBeUndefined()
  })

  it("forget a GET that came back with nothing to keep", () => {
    const gets = makeKeptGets<string>()
    gets.begin("radarr", "/movie", "failed", now)(now + 100, false)
    expect(gets.find("radarr", "/movie", now + 100, 60_000)).toBeUndefined()
    expect(gets.size()).toBe(0)
  })

  it("leave a newer GET alone when an older one of the same comes back late", () => {
    const gets = makeKeptGets<string>()
    const first = gets.begin("radarr", "/movie", "first", now)
    gets.forget()
    const second = gets.begin("radarr", "/movie", "second", now + 10)
    first(now + 20, false)
    expect(gets.find("radarr", "/movie", now + 20, 0)).toBe("second")
    second(now + 30, true)
    first(now + 40, true)
    expect(gets.find("radarr", "/movie", now + 50, 60_000)).toBe("second")
  })

  it("forget one service's, or all", () => {
    const gets = makeKeptGets<string>()
    gets.begin("radarr", "/movie", "movies", now)(now, true)
    gets.begin("radarr", "/queue", "queue", now)(now, true)
    gets.begin("sonarr", "/series", "series", now)(now, true)
    gets.forget("radarr")
    expect(gets.size()).toBe(1)
    expect(gets.find("sonarr", "/series", now, 60_000)).toBe("series")
    gets.forget()
    expect(gets.size()).toBe(0)
  })

  it("don't pile up: a path asked once (a history since a moment) goes when it is too old for anyone", () => {
    const gets = makeKeptGets<string>(60_000)
    for (let minute = 0; minute < 100; minute++) {
      const at = now + minute * 60_000
      gets.begin("radarr", `/history/since?date=${at}`, "grabs", at)(at, true)
    }
    expect(gets.size()).toBe(1)
    // One still on its way is never dropped, however long it takes.
    gets.begin("sonarr", "/slow", "waiting", now)
    gets.begin("radarr", "/movie", "movies", now + 10 * 3_600_000)
    expect(gets.find("sonarr", "/slow", now + 10 * 3_600_000, 0)).toBe("waiting")
  })
})
