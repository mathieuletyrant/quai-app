import { describe, expect, it } from "@effect/vitest"
import { HomeOffline } from "@quai/api"
import { offlineMessage } from "@quai/domain/home/HomeLink.ts"
import { answerKeptMs, HomeReads } from "@quai/domain/home/HomeReads.ts"
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
