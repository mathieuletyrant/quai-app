import { DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/http"
import { DownloadActivities } from "../src/engine/DownloadActivities.ts"
import { Devices } from "../src/store/Devices.ts"
import { TestApp } from "./testApp.ts"

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
      expect(Exit.isFailure(yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: late.code } })))).toBe(true)

      const devices = yield* api.console.devices()
      expect(devices.map((d) => [d.name, d.canStartActivities])).toEqual([["iPhone de Mathieu", true]])
    }).pipe(Effect.provide(TestApp)))

  it.effect("the iPhone routes need its token; a removed iPhone is locked out", () =>
    Effect.gen(function*() {
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
      yield* (yield* DownloadActivities).handle({ _tag: "Added", mediaKey: "movie:tmdb:1", title: "Dune" })
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({ payload: { serverUrls: [] } })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({ payload: { ...iphone, code: qr.code } })
      const api = yield* signedIn(token)
      const list = yield* api.devices.activities()
      expect(list.map((a) => [a.attributes.title, a.content.step])).toEqual([["Dune", "searching"]])
    }).pipe(Effect.provide(TestApp)))
})
