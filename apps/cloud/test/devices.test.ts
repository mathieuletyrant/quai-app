import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi } from "@quai/api"
import { Activities } from "@quai/domain/flows/Activities.ts"
import { Devices } from "@quai/domain/home/Devices.ts"
import * as DeviceToken from "@quai/domain/home/DeviceToken.ts"
import { HomeLink } from "@quai/domain/home/HomeLink.ts"
import type { ApnsRequest } from "@quai/domain/push/Apns.ts"
import { Effect, Exit, Option } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { testHomeId } from "./fakeHome.ts"
import { connectedHome, TestApp, testAppPushingTo } from "./testApp.ts"

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

      const store = yield* Devices
      expect(yield* store.holdsPairingCode(` ${qr.code.toLowerCase()} `)).toBe(true)
      expect(yield* store.holdsPairingCode("ABCDEFGH")).toBe(false)
      const paired = yield* api.devices.pair({ payload: { ...iphone, code: qr.code.toLowerCase() } })
      // The token names its home, so a Cloud of several homes finds it.
      expect(DeviceToken.homeOf(paired.token)).toEqual(Option.some(testHomeId))
      expect(yield* store.holdsToken(paired.token)).toBe(true)
      expect(yield* store.holdsToken(`${testHomeId}.${"x".repeat(43)}`)).toBe(false)
      expect(yield* store.holdsPairingCode(qr.code)).toBe(false)

      const again = yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: qr.code } }))
      expect(Exit.isFailure(again)).toBe(true)

      const late = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      yield* TestClock.adjust("601 seconds")
      // Still linked (pinged all along): the code failed for its age.
      expect(Option.isSome(yield* (yield* HomeLink).home)).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: late.code } })))).toBe(
        true
      )

      const devices = yield* api.console.devices()
      expect(devices.map((device) => [device.name, device.canStartActivities])).toEqual([["iPhone de Mathieu", true]])
    }).pipe(Effect.provide(TestApp)))

  it.effect("the iPhone routes need its token; a removed iPhone is locked out", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { deviceId, token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })

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
      yield* (yield* Activities).handle({
        type: "media.added",
        subject: { kind: "media", key: "movie:tmdb:1", title: "Dune", mediaType: "movie" }
      })
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const api = yield* signedIn(token)
      const list = yield* api.devices.activities()
      expect(list.map((activity) => [activity.attributes.title, activity.attributes.steps[activity.content.step]?.id]))
        .toEqual([["Dune", "searching"]])
    }).pipe(Effect.provide(TestApp)))
})

describe("preferences", () => {
  it.effect("each iPhone keeps its own per flow, and sees every flow", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const phone = yield* signedIn(token)
      expect(yield* phone.devices.preferences()).toEqual({ flows: {} })
      const saved = yield* phone.devices.savePreferences({
        payload: {
          flows: {
            download: { enabled: true, hiddenSteps: ["searching"] },
            incident: { enabled: false, hiddenSteps: [] }
          }
        }
      })
      expect(saved.flows["incident"]?.enabled).toBe(false)
      expect((yield* phone.devices.preferences()).flows["download"]?.hiddenSteps).toEqual(["searching"])
      expect((yield* phone.devices.flows()).map((flow) => flow.id)).toEqual([
        "download",
        "playback",
        "request",
        "today"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("keeps the Home tiles as the iPhone set them, names it doesn't know included", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const phone = yield* signedIn(token)
      // A newer app may name a tile this Cloud never heard of: kept as it came.
      const homeTiles = { order: ["storage", "toFix", "aNewTile"], hidden: ["wanted"] }
      yield* phone.devices.savePreferences({ payload: { flows: {}, homeTiles } })
      expect((yield* phone.devices.preferences()).homeTiles).toEqual(homeTiles)
    }).pipe(Effect.provide(TestApp)))
})

describe("flows from the console", () => {
  it.effect("create, edit and delete a custom flow; built-in ones can be reset, not deleted", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["flows"])
      const download = (yield* api.flows.list()).find((flow) => flow.id === "download")!
      const anime = yield* api.flows.save({
        params: { id: "anime" },
        payload: { ...download, id: "anime", name: "Anime", builtIn: true, filter: { mediaType: "series" } }
      })
      expect(anime.builtIn).toBe(false)
      expect((yield* api.flows.list()).map((flow) => flow.id)).toEqual([
        "download",
        "playback",
        "request",
        "today",
        "anime"
      ])

      const bad = yield* Effect.exit(api.flows.save({
        params: { id: "bad" },
        payload: {
          ...download,
          id: "bad",
          steps: [download.steps[0]!, { ...download.steps[1]!, on: "request.pending" }]
        }
      }))
      expect(Exit.isFailure(bad)).toBe(true)
      const wrongButton = yield* Effect.exit(api.flows.save({
        params: { id: "bad" },
        payload: {
          ...download,
          id: "bad",
          steps: [download.steps[0]!, { ...download.steps[1]!, actions: ["playback.stop"] }]
        }
      }))
      expect(Exit.isFailure(wrongButton)).toBe(true)
      const oneStepNoEnd = yield* Effect.exit(
        api.flows.save({ params: { id: "bad" }, payload: { ...download, id: "bad", steps: [download.steps[1]!] } })
      )
      expect(Exit.isFailure(oneStepNoEnd)).toBe(true)

      yield* api.flows.save({ params: { id: "download" }, payload: { ...download, color: "#123456" } })
      expect((yield* api.flows.list()).find((flow) => flow.id === "download")?.color).toBe("#123456")
      expect((yield* api.flows.reset({ params: { id: "download" } })).color).toBe("#FFC230")

      expect(Exit.isFailure(yield* Effect.exit(api.flows.remove({ params: { id: "download" } })))).toBe(true)
      yield* api.flows.remove({ params: { id: "anime" } })
      expect((yield* api.flows.list()).map((flow) => flow.id)).toEqual(["download", "playback", "request", "today"])
      expect((yield* api.flows.catalog()).length).toBeGreaterThan(5)
      expect((yield* api.flows.actions()).map((activity) => activity.type)).toEqual([
        "playback.playPause",
        "playback.stop",
        "request.approve",
        "request.decline"
      ])
    }).pipe(Effect.provide(TestApp)))

  it.effect("an activity swiped away is forgotten with where it was, until the iPhone shows it again", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { deviceId, token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const phone = yield* signedIn(token)
      const tv = { kind: "playback" as const, key: "playback:s1:i1", title: "Dune", device: "TV Salon" }
      yield* (yield* Activities).handle({ type: "playback.started", subject: tv, values: { paused: true } })
      const key = "playback|playback:s1:i1"
      yield* phone.devices.activityToken({ payload: { mediaKey: key, pushToken: "act-1" } })
      const store = yield* Devices
      const target = () =>
        Effect.map(store.targets(key), (all) => all.find((pushTarget) => pushTarget.deviceId === deviceId)!)

      yield* phone.devices.shownActivities({ payload: { keys: [key] } })
      expect((yield* target()).activityToken).toBe("act-1")

      yield* phone.devices.shownActivities({ payload: { keys: [] } })
      expect(yield* target()).toMatchObject({ activityToken: null, dismissed: { stepIndex: 0, paused: true } })

      yield* phone.devices.activityToken({ payload: { mediaKey: key, pushToken: "act-2" } })
      expect(yield* target()).toMatchObject({ activityToken: "act-2", dismissed: null })
    }).pipe(Effect.provide(TestApp)))
})

describe("quiet", () => {
  it.effect("the iPhone says when its Focus filter turns quiet on and off", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { deviceId, token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { ...iphone, code: qr.code }
      })
      const phone = yield* signedIn(token)
      const quiet = Effect.map(
        (yield* Devices).targets("download|movie:tmdb:1"),
        (all) => all.find((target) => target.deviceId === deviceId)!.quiet
      )
      expect(yield* quiet).toBe(false)

      yield* phone.devices.update({ payload: { quiet: true } })
      expect(yield* quiet).toBe(true)
      // Another change leaves it as it is.
      yield* phone.devices.update({ payload: { name: "iPhone 17" } })
      expect(yield* quiet).toBe(true)
      yield* phone.devices.update({ payload: { quiet: false } })
      expect(yield* quiet).toBe(false)
    }).pipe(Effect.provide(TestApp)))
})

describe("a Live Activity the engine forgot", () => {
  const sent: Array<ApnsRequest> = []
  const key = "download|movie:tmdb:1"
  const pairedPhone = Effect.gen(function*() {
    yield* connectedHome
    const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
      payload: { serverUrls: [] }
    })
    const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
      payload: { ...iphone, code: qr.code }
    })
    return yield* signedIn(token)
  })
  const ends = () => sent.filter((request) => (request.body as any).aps.event === "end")

  it.effect("ends when its token comes, and again when the app says it's still on screen", () =>
    Effect.gen(function*() {
      sent.length = 0
      const phone = yield* pairedPhone

      // Its token comes long after the engine forgot it: it ends at once.
      yield* phone.devices.activityToken({ payload: { mediaKey: key, pushToken: "act-1" } })
      expect(ends().map((request) => request.deviceToken)).toEqual(["act-1"])

      // The app comes to the front with it still shown: the token it gave ends it.
      yield* phone.devices.shownActivities({ payload: { keys: [key] } })
      expect(ends().map((request) => request.deviceToken)).toEqual(["act-1", "act-1"])

      // One the engine runs is left alone.
      yield* (yield* Activities).handle({
        type: "media.added",
        subject: { kind: "media", key: "movie:tmdb:2", title: "Heat", mediaType: "movie" }
      })
      yield* phone.devices.activityToken({ payload: { mediaKey: "download|movie:tmdb:2", pushToken: "act-2" } })
      yield* phone.devices.shownActivities({ payload: { keys: ["download|movie:tmdb:2"] } })
      expect(ends()).toHaveLength(2)
    }).pipe(Effect.provide(testAppPushingTo(sent))))
})
