import { DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/http"
import { Activities } from "../src/flows/Activities.ts"
import { Devices } from "../src/home/Devices.ts"
import { HomeLink } from "../src/home/HomeLink.ts"
import { connectedHome, TestApp } from "./testApp.ts"

/** The iPhone's side of DeviceAuth: send the token the pairing returned. */
const signedIn = (token: string) =>
  HttpApiTest.groups(QuaiApi, ["devices"]).pipe(
    Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) =>
      next(HttpClientRequest.bearerToken(request, token))))
  )

const iphone = { name: "iPhone de Mathieu", apnsEnvironment: "development" as const, pushToStartToken: "pts-1" }

describe("pairing", () => {
  it.effect("a QR code pairs one iPhone, once, within 10 minutes", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices"])
      const qr = yield* api.console.createPairingCode({ payload: { serverUrls: ["http://umbrel.local:3078"] } })
      expect(qr.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
      expect(qr.link).toBe(`quai://pair?code=${qr.code}&url=http%3A%2F%2Fumbrel.local%3A3078`)

      const paired = yield* api.devices.pair({ payload: { ...iphone, code: qr.code.toLowerCase() } })
      expect(paired.token.length).toBeGreaterThan(30)

      const again = yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: qr.code } }))
      expect(Exit.isFailure(again)).toBe(true)

      const late = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      yield* TestClock.adjust("601 seconds")
      // Still linked (pinged all along): the code failed for its age.
      expect(Option.isSome(yield* (yield* HomeLink).home)).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: late.code } })))).toBe(true)

      const devices = yield* api.console.devices()
      expect(devices.map((d) => [d.name, d.canStartActivities])).toEqual([["iPhone de Mathieu", true]])
    }).pipe(Effect.provide(TestApp)))

  it.effect("the iPhone routes need its token; a removed iPhone is locked out", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
      const { deviceId, token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })

      const anonymous = yield* HttpApiTest.groups(QuaiApi, ["devices"])
      expect(Exit.isFailure(yield* Effect.exit(anonymous.devices.activities()))).toBe(true)

      const phone = yield* signedIn(token)
      expect(yield* phone.devices.activities()).toEqual([])
      yield* phone.devices.activityToken({ payload: { mediaKey: "movie:tmdb:1", pushToken: "act-1" } })
      expect(yield* (yield* Devices).activityRecipients("movie:tmdb:1")).toEqual([
        { deviceId, apnsEnvironment: "development", token: "act-1" }
      ])

      yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.removeDevice({ params: { id: deviceId } })
      expect(Exit.isFailure(yield* Effect.exit(phone.devices.activities()))).toBe(true)
    }).pipe(Effect.provide(TestApp)))

  it.effect("lists the running activities to the iPhone", () =>
    Effect.gen(function*() {
      yield* connectedHome
      yield* (yield* Activities).handle({ type: "media.added", subject: { kind: "media", key: "movie:tmdb:1", title: "Dune", mediaType: "movie" } })
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
      const api = yield* signedIn(token)
      const list = yield* api.devices.activities()
      expect(list.map((a) => [a.attributes.title, a.attributes.steps[a.content.step]?.id])).toEqual([["Dune", "searching"]])
    }).pipe(Effect.provide(TestApp)))
})

describe("preferences", () => {
  it.effect("each iPhone keeps its own per flow, and sees every flow", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
      const phone = yield* signedIn(token)
      expect(yield* phone.devices.preferences()).toEqual({ flows: {} })
      const saved = yield* phone.devices.savePreferences({
        payload: { flows: { download: { enabled: true, hiddenSteps: ["searching"] }, incident: { enabled: false, hiddenSteps: [] } } }
      })
      expect(saved.flows["incident"]?.enabled).toBe(false)
      expect((yield* phone.devices.preferences()).flows["download"]?.hiddenSteps).toEqual(["searching"])
      expect((yield* phone.devices.flows()).map((f) => f.id)).toEqual(["download", "playback", "request", "today"])
    }).pipe(Effect.provide(TestApp)))
})

describe("flows from the console", () => {
  it.effect("create, edit and delete a custom flow; built-in ones can be reset, not deleted", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["flows"])
      const download = (yield* api.flows.list()).find((f) => f.id === "download")!
      const anime = yield* api.flows.save({
        params: { id: "anime" },
        payload: { ...download, id: "anime", name: "Anime", builtIn: true, filter: { mediaType: "series" } }
      })
      expect(anime.builtIn).toBe(false)
      expect((yield* api.flows.list()).map((f) => f.id)).toEqual(["download", "playback", "request", "today", "anime"])

      const bad = yield* Effect.exit(api.flows.save({
        params: { id: "bad" },
        payload: { ...download, id: "bad", steps: [download.steps[0]!, { ...download.steps[1]!, on: "request.pending" }] }
      }))
      expect(Exit.isFailure(bad)).toBe(true)
      const wrongButton = yield* Effect.exit(api.flows.save({
        params: { id: "bad" },
        payload: { ...download, id: "bad", steps: [download.steps[0]!, { ...download.steps[1]!, actions: ["playback.stop"] }] }
      }))
      expect(Exit.isFailure(wrongButton)).toBe(true)
      const oneStepNoEnd = yield* Effect.exit(api.flows.save({ params: { id: "bad" }, payload: { ...download, id: "bad", steps: [download.steps[1]!] } }))
      expect(Exit.isFailure(oneStepNoEnd)).toBe(true)

      yield* api.flows.save({ params: { id: "download" }, payload: { ...download, color: "#123456" } })
      expect((yield* api.flows.list()).find((f) => f.id === "download")?.color).toBe("#123456")
      expect((yield* api.flows.reset({ params: { id: "download" } })).color).toBe("#FFC230")

      expect(Exit.isFailure(yield* Effect.exit(api.flows.remove({ params: { id: "download" } })))).toBe(true)
      yield* api.flows.remove({ params: { id: "anime" } })
      expect((yield* api.flows.list()).map((f) => f.id)).toEqual(["download", "playback", "request", "today"])
      expect((yield* api.flows.catalog()).length).toBeGreaterThan(5)
      expect((yield* api.flows.actions()).map((a) => a.type)).toEqual(["playback.playPause", "playback.stop", "request.approve", "request.decline"])
    }).pipe(Effect.provide(TestApp)))

  it.effect("an activity swiped away is forgotten with where it was, until the iPhone shows it again", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
      const { deviceId, token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
      const phone = yield* signedIn(token)
      const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }
      yield* (yield* Activities).handle({ type: "playback.started", subject: tv, values: { paused: true } })
      const key = "playback|playback:s1:i1"
      yield* phone.devices.activityToken({ payload: { mediaKey: key, pushToken: "act-1" } })
      const store = yield* Devices
      const target = () => Effect.map(store.targets(key), (all) => all.find((t) => t.deviceId === deviceId)!)

      yield* phone.devices.shownActivities({ payload: { keys: [key] } })
      expect((yield* target()).activityToken).toBe("act-1")

      yield* phone.devices.shownActivities({ payload: { keys: [] } })
      expect(yield* target()).toMatchObject({ activityToken: null, dismissed: { stepIndex: 0, paused: true } })

      yield* phone.devices.activityToken({ payload: { mediaKey: key, pushToken: "act-2" } })
      expect(yield* target()).toMatchObject({ activityToken: "act-2", dismissed: null })
    }).pipe(Effect.provide(TestApp)))
})
