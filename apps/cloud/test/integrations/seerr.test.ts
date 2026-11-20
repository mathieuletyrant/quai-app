import { builtInFlows, DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Option, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { ActionRunner } from "../../src/flows/ActionRunner.ts"
import { Activities } from "../../src/flows/Activities.ts"
import {
  decodeSeerrWebhook,
  pendingWatchId,
  requestDetail,
  SeerrTitles,
  SeerrRequestPage,
  seerrEvents,
  splitSubject,
  toMediaRequest,
  waiting
} from "../../src/integrations/seerr.ts"
import { Apns } from "../../src/push/Apns.ts"
import { Hub } from "../../src/integrations/Hub.ts"
import { HomeError, HomeLink, offlineMessage } from "../../src/home/HomeLink.ts"
import { Requests } from "../../src/requests/Requests.ts"
import { Integrations } from "../../src/integrations/Integration.ts"
import { cloudLive, type FakeHomeOptions, makeFakeHome, settle } from "../fakeHome.ts"
import { fixture } from "../fixtures.ts"
import { TestApp } from "../testApp.ts"

const now = Date.parse("2026-11-20T10:00:00Z")
const services = ["radarr", "sonarr", "qbittorrent", "jellyfin", "seerr"] as const

const webhookEvents = (name: string) => Effect.map(decodeSeerrWebhook(fixture(`seerr/${name}.json`)), seerrEvents)

/** Quai Home answering from the recordings: the pending list, the titles, and request 12 as `request12`. */
const seerrAnswers = (state: { request12: "pending" | "approved" | "gone"; pending: ReadonlyArray<number> }): NonNullable<FakeHomeOptions["answer"]> => (call) => {
  if (call.service !== "seerr") return { status: 404 }
  const path = call.path.split("?")[0]!
  const page = fixture("seerr/requests-pending.json") as { results: Array<{ id: number }> }
  if (call.method === "POST") return { json: fixture("seerr/request-approved.json") }
  if (path === "/api/v1/request") return { json: { ...page, results: page.results.filter((r) => state.pending.includes(r.id)) } }
  if (path === "/api/v1/request/12") {
    return state.request12 === "gone"
      ? { status: 404, json: { message: "Request not found." } }
      : { json: state.request12 === "approved" ? fixture("seerr/request-approved.json") : page.results[0] }
  }
  if (path === "/api/v1/movie/516729") return { json: fixture("seerr/movie.json") }
  if (path === "/api/v1/tv/95396") return { json: fixture("seerr/tv.json") }
  return { status: 404 }
}

const engine = cloudLive.pipe(Layer.provide(Layer.effect(Apns, Apns.make(null))))
const running = Effect.gen(function*() {
  return [...(yield* (yield* Activities).snapshot).activities.values()]
})

describe("Seerr requests", () => {
  it.effect("reads its notifications: pending starts, approved and declined follow; auto-approved, a test: nothing", () =>
    Effect.gen(function*() {
      const [pending] = yield* webhookEvents("webhook-pending")
      expect(pending).toEqual({
        type: "request.pending",
        subject: { kind: "request", key: "request:12", title: "Paddington in Peru", mediaType: "movie", requester: "Julie" },
        values: { detail: "Julie · Movie · 2024" }
      })
      expect((yield* webhookEvents("webhook-approved")).map((e) => e.type)).toEqual(["request.approved"])
      expect((yield* webhookEvents("webhook-declined")).map((e) => [e.type, e.values?.detail])).toEqual([["request.declined", "Declined"]])
      expect(yield* webhookEvents("webhook-auto-approved")).toEqual([])
      expect(yield* webhookEvents("webhook-test")).toEqual([])
    }))

  it("lists only what waits, with its title, requester, seasons and poster", () => {
    const page = Schema.decodeUnknownSync(SeerrRequestPage)(fixture("seerr/requests-pending.json"))
    const autoApproved = { ...page.results[0]!, id: 14, status: 2 }
    expect(waiting([...page.results, autoApproved]).map((r) => r.id)).toEqual([12, 13])
    expect(toMediaRequest(page.results[1]!, { title: "Severance", year: 2022, posterUrl: "https://image.tmdb.org/t/p/w342/p.jpg" })).toEqual({
      id: 13,
      kind: "series",
      title: "Severance",
      year: 2022,
      posterUrl: "https://image.tmdb.org/t/p/w342/p.jpg",
      requester: "Julie",
      requestedAt: Date.parse("2026-11-20T08:05:00.000Z") / 1000,
      seasons: [1, 2],
      is4k: false
    })
    expect(requestDetail("Julie", "series", { seasons: [1, 2, 3], is4k: true })).toBe("Julie · Series · S1–3 · 4K")
    expect(splitSubject("Paddington in Peru (2024)")).toEqual({ title: "Paddington in Peru", year: 2024 })
    expect(splitSubject("Severance")).toEqual({ title: "Severance" })
  })

  it.effect("a pending request starts one activity with Approve and Decline; an auto-approved one starts nothing", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services, answer: seerrAnswers({ request12: "pending", pending: [] }) })
      yield* home.connect
      expect(home.watch(pendingWatchId)).toMatchObject({ service: "seerr", everySeconds: 60 })

      yield* home.webhook("seerr", fixture("seerr/webhook-auto-approved.json"))
      expect(yield* running).toEqual([])

      yield* home.webhook("seerr", fixture("seerr/webhook-pending.json"))
      const [activity] = yield* running
      expect(activity).toMatchObject({ key: "request|request:12", title: "Paddington in Peru", stepIndex: 0, values: { detail: "Julie · Movie · 2024" } })

      // Approved in Seerr: the last step ends it.
      yield* home.webhook("seerr", fixture("seerr/webhook-approved.json"))
      const [approved] = yield* running
      expect(approved).toMatchObject({ stepIndex: 1, tone: "done" })
      expect(approved!.endedAt).not.toBeNull()
    }).pipe(Effect.provide(engine)))

  it.effect("declined ends it where it is, saying so", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services, answer: seerrAnswers({ request12: "pending", pending: [] }) })
      yield* home.connect
      yield* home.webhook("seerr", fixture("seerr/webhook-pending.json"))
      yield* home.webhook("seerr", fixture("seerr/webhook-declined.json"))
      const [declined] = yield* running
      expect(declined).toMatchObject({ stepIndex: 0, tone: "done", values: { detail: "Declined" } })
      expect(declined!.endedAt).not.toBeNull()
    }).pipe(Effect.provide(engine)))

  it.effect("without the webhook, the poll finds what waits, and what was approved or deleted meanwhile", () =>
    Effect.gen(function*() {
      const state = { request12: "pending" as "pending" | "approved" | "gone", pending: [12, 13] as ReadonlyArray<number> }
      const home = yield* makeFakeHome({ services, answer: seerrAnswers(state) })
      yield* home.connect
      const page = fixture("seerr/requests-pending.json") as { results: Array<{ id: number }> }
      yield* home.snapshot(pendingWatchId, page)
      expect((yield* running).map((a) => [a.subjectKey, a.title, a.values.detail])).toEqual([
        ["request:12", "Paddington in Peru", "Julie · Movie · 2024"],
        ["request:13", "Severance", "Julie · Series · 2022 · S1–2"]
      ])
      // The same list again (a restarted Cloud's first read): nothing new, nothing written.
      const writes = home.received.filter((m) => m._tag === "StorePut").length
      yield* home.snapshot(pendingWatchId, { ...page, pageInfo: { page: 1 } })
      expect(home.received.filter((m) => m._tag === "StorePut").length).toBe(writes)

      // Request 12 approved in Seerr's own page, 13 deleted.
      state.request12 = "approved"
      yield* home.snapshot(pendingWatchId, { ...page, results: [] })
      const calls = home.calls.map((c) => `${c.method} ${c.path}`)
      expect(calls).toContain("GET /api/v1/request/12")
      expect(calls).toContain("GET /api/v1/request/13")
      expect((yield* running).map((a) => [a.subjectKey, a.stepIndex, a.endedAt !== null, a.values.detail])).toEqual([
        ["request:12", 1, true, "Julie"],
        ["request:13", 0, true, "Removed"]
      ])
    }).pipe(Effect.provide(engine)))

  it.effect("a request pending for days keeps its one activity: never forgotten, never started again", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome({ services, answer: seerrAnswers({ request12: "pending", pending: [12, 13] }) })
      yield* home.connect
      const page = fixture("seerr/requests-pending.json") as { results: Array<{ id: number }> }
      yield* home.snapshot(pendingWatchId, page)
      const before = yield* running
      expect(before.map((a) => a.subjectKey)).toEqual(["request:12", "request:13"])
      const hub = yield* Hub
      for (let day = 0; day < 3; day++) {
        yield* TestClock.adjust("25 hours")
        yield* hub.beat
        yield* home.snapshot(pendingWatchId, { ...page, pageInfo: { page: day } })
      }
      const after = yield* running
      expect(after.map((a) => [a.subjectKey, a.enteredAt, a.endedAt])).toEqual(before.map((a) => [a.subjectKey, a.enteredAt, null]))
    }).pipe(Effect.provide(engine)))

  it.effect("only the requests a flow's filter takes start it, and the others aren't sent again at each poll", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services, answer: seerrAnswers({ request12: "pending", pending: [12, 13] }) })
      yield* home.connect
      const request = builtInFlows.find((f) => f.id === "request")!
      const series = { ...request, filter: { mediaType: "series" as const } }
      const integration = (yield* Integrations).find((i) => i.service === "seerr")!
      const watch = { id: pendingWatchId, service: "seerr" as const, path: "/api/v1/request", everySeconds: 60 }
      const events = yield* integration.watcher!.read(
        { watch, status: 200, body: JSON.stringify(fixture("seerr/requests-pending.json")) },
        { flows: [series], running: [], services, now, timeZone: "UTC" }
      )
      expect(events.map((e) => e.subject?.key)).toEqual(["request:13"])
    }).pipe(Effect.provide(engine)))

  it.effect("Approve on the Live Activity approves it in Seerr, and has Quai Home read the requests again", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services, answer: seerrAnswers({ request12: "pending", pending: [12] }) })
      yield* home.connect
      yield* home.webhook("seerr", fixture("seerr/webhook-pending.json"))
      const before = home.received.filter((m) => m._tag === "SetWatches").length
      yield* (yield* ActionRunner).run("request|request:12", "request.approve")
      yield* settle
      expect(home.calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body])).toEqual([["/api/v1/request/12/approve", undefined]])
      expect(home.received.filter((m) => m._tag === "SetWatches").length).toBe(before + 1)
      // Nothing to approve on an approved request.
      yield* home.webhook("seerr", fixture("seerr/webhook-approved.json"))
      const refused = yield* Effect.exit((yield* ActionRunner).run("request|request:12", "request.decline"))
      expect(Exit.isFailure(refused)).toBe(true)
    }).pipe(Effect.provide(ActionRunner.layer.pipe(Layer.provideMerge(engine)))))
})

describe("requests routes", () => {
  const iphone = { name: "iPhone", apnsEnvironment: "development" as const }
  const setUp = (options: FakeHomeOptions) =>
    Effect.gen(function*() {
      yield* TestClock.setTime(now)
      const home = yield* makeFakeHome(options)
      yield* home.connect
      const console = yield* HttpApiTest.groups(QuaiApi, ["console", "consoleRequests"])
      const qr = yield* console.console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
      const api = yield* HttpApiTest.groups(QuaiApi, ["requests"]).pipe(
        Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
      )
      return { home, api: api.requests, console: console.consoleRequests }
    })

  it.effect("lists the pending requests, oldest first, with posters", () =>
    Effect.gen(function*() {
      const { api, console } = yield* setUp({ services, answer: seerrAnswers({ request12: "pending", pending: [12, 13] }) })
      const list = yield* api.list()
      expect(list.status).toBe("ok")
      expect(list.items.map((r) => [r.id, r.title, r.year, r.kind, r.posterUrl])).toEqual([
        [12, "Paddington in Peru", 2024, "movie", "https://image.tmdb.org/t/p/w342/1ffZAucqfvQu36x1C49XfOdjuOG.jpg"],
        [13, "Severance", 2022, "series", "https://image.tmdb.org/t/p/w342/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg"]
      ])
      expect((yield* console.list()).items).toHaveLength(2)
    }).pipe(Effect.provide(TestApp)))

  it.effect("approves or declines one that still waits; one decided meanwhile is a 404", () =>
    Effect.gen(function*() {
      const state = { request12: "pending" as "pending" | "approved" | "gone", pending: [12] as ReadonlyArray<number> }
      const { home, api, console } = yield* setUp({ services, answer: seerrAnswers(state) })
      yield* api.approve({ params: { id: "12" } })
      yield* console.decline({ params: { id: "12" } })
      expect(home.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        "/api/v1/request/12/approve",
        "/api/v1/request/12/decline"
      ])
      state.request12 = "approved"
      expect((yield* Effect.flip(api.decline({ params: { id: "12" } })))._tag).toBe("NotFound")
      expect((yield* Effect.flip(api.approve({ params: { id: "x" } })))._tag).toBe("NotFound")
      expect(home.calls.filter((c) => c.method === "POST")).toHaveLength(2)
    }).pipe(Effect.provide(TestApp)))

  it.effect("says when Quai Home has no Seerr, or Seerr doesn't answer", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services: ["radarr"] })
      expect(yield* api.list()).toEqual({ items: [], status: "notConfigured" })
    }).pipe(Effect.provide(TestApp)))

  it.effect("Seerr not answering: unavailable", () =>
    Effect.gen(function*() {
      const { api } = yield* setUp({ services, answer: () => ({ failed: "unreachable" }) })
      expect(yield* api.list()).toEqual({ items: [], status: "unavailable" })
    }).pipe(Effect.provide(TestApp)))
})

describe("requests when Quai Home goes offline mid-read", () => {
  /** Connected when asked, but every call fails as the link drops. */
  const dropping = Layer.succeed(HomeLink, {
    home: Effect.succeed(Option.some({ homeId: "h", services: ["seerr" as const] })),
    call: () => Effect.fail(new HomeError({ reason: "offline", message: offlineMessage })),
    setWatches: () => Effect.void,
    documents: undefined as never,
    nextEvent: Effect.never,
    serve: () => Effect.void
  })
  const hub = Layer.succeed(Hub, { apply: () => Effect.void, beat: Effect.void, sync: Effect.void, refresh: () => Effect.void, handle: () => Effect.void })
  const layer = Requests.layer.pipe(Layer.provide(SeerrTitles.layer), Layer.provide([dropping, hub]))

  it.effect("is HomeOffline (503), not Seerr unavailable or a Seerr failure", () =>
    Effect.gen(function*() {
      const requests = yield* Requests
      expect((yield* Effect.flip(requests.list))._tag).toBe("HomeOffline")
      expect((yield* Effect.flip(requests.decide("12", "approve")))._tag).toBe("HomeOffline")
    }).pipe(Effect.provide(layer)))
})
