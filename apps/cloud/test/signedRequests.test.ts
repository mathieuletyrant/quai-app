import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi, RequestSignature } from "@quai/api"
import { deviceKeyOf, problemMessages, signatureHeadersOf } from "@quai/domain/home/RequestSignature.ts"
import { Effect } from "effect"
import { HttpClientRequest, UrlParams } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import type { KeyObject } from "node:crypto"
import { connectedHome, TestApp } from "./testApp.ts"

const now = Date.parse("2026-11-27T12:00:00Z")
const key = deviceKeyOf(Uint8Array.from({ length: 32 }, (_, index) => index + 1))
const iphone = { name: "iPhone", apnsEnvironment: "development" as const }

/** The body a request carries, as text: what its signature covers. */
const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""

let nonces = 0
/** How an iPhone signs: its clock, a nonce of its own, its key. `change` is what happens on the way. */
interface Signing {
  readonly privateKey: KeyObject
  readonly clock?: number
  readonly nonce?: string
  readonly change?: (signed: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
}

/** The iPhone's side: its token, and, with a key, the three headers that sign the request. */
const iPhoneApi = (token: string, signing?: Signing) =>
  HttpApiTest.groups(QuaiApi, ["devices", "fixes"]).pipe(
    Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => {
      const authorized = HttpClientRequest.bearerToken(request, token)
      if (signing === undefined) return next(authorized)
      const query = UrlParams.toString(request.urlParams)
      const headers = signatureHeadersOf(signing.privateKey, {
        method: request.method,
        path: query === "" ? request.url : `${request.url}?${query}`,
        body: bodyOf(request),
        time: signing.clock ?? now,
        nonce: signing.nonce ?? `n${++nonces}`
      })
      const signed = HttpClientRequest.setHeaders(authorized, headers)
      return next(signing.change?.(signed) ?? signed)
    }))
  )

/** A home with an iPhone paired with its device key, and one paired without. */
const paired = Effect.gen(function*() {
  yield* TestClock.setTime(now)
  yield* connectedHome
  const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices"])
  const pair = (payload: object) =>
    Effect.flatMap(
      api.console.createPairingCode({ payload: { serverUrls: [] } }),
      (qr) => api.devices.pair({ payload: { ...iphone, ...payload, code: qr.code } })
    )
  return {
    api,
    withKey: yield* pair({ name: "With a key", deviceKey: key.publicKey }),
    without: yield* pair({ name: "From before" })
  }
})

const refused = (problem: keyof typeof problemMessages) => ({
  _tag: "InvalidSignature",
  message: problemMessages[problem]
})

describe("an iPhone paired with a device key", () => {
  it.effect("is answered when it signs its requests, with or without a body", () =>
    Effect.gen(function*() {
      const { api, withKey } = yield* paired
      const iPhone = yield* iPhoneApi(withKey.token, { privateKey: key.privateKey })
      expect(yield* iPhone.devices.preferences()).toHaveProperty("flows")
      yield* iPhone.devices.update({ payload: { name: "Renamed", timeZone: "Europe/Paris" } })
      expect(yield* iPhone.devices.activities()).toEqual([])
      const devices = yield* api.console.devices()
      // In no order of their own: the list follows the iPhones' ids.
      expect(new Map(devices.map((device) => [device.name, device.signsRequests]))).toEqual(
        new Map([["Renamed", true], ["From before", false]])
      )
    }).pipe(Effect.provide(TestApp)))

  it.effect("isn't answered for its token alone: whoever carries the request can't make one", () =>
    Effect.gen(function*() {
      const { withKey } = yield* paired
      const carrier = yield* iPhoneApi(withKey.token)
      expect(yield* Effect.flip(carrier.devices.preferences())).toMatchObject(refused("unsigned"))
      expect(yield* Effect.flip(carrier.devices.update({ payload: { name: "Taken over" } }))).toMatchObject(
        refused("unsigned")
      )
    }).pipe(Effect.provide(TestApp)))

  it.effect("isn't answered twice for the same request: it can't be played again", () =>
    Effect.gen(function*() {
      const { withKey } = yield* paired
      const iPhone = yield* iPhoneApi(withKey.token, { privateKey: key.privateKey, nonce: "once" })
      expect(yield* iPhone.devices.preferences()).toHaveProperty("flows")
      expect(yield* Effect.flip(iPhone.devices.preferences())).toMatchObject(refused("replayed"))
    }).pipe(Effect.provide(TestApp)))

  it.effect("isn't answered for a request changed on the way, or signed by another key", () =>
    Effect.gen(function*() {
      const { withKey } = yield* paired
      const rewritten = yield* iPhoneApi(withKey.token, {
        privateKey: key.privateKey,
        change: (signed) => HttpClientRequest.bodyJsonUnsafe(signed, { name: "Taken over" })
      })
      expect(yield* Effect.flip(rewritten.devices.update({ payload: { name: "Mine" } }))).toMatchObject(
        refused("forged")
      )
      const other = deviceKeyOf(Uint8Array.from({ length: 32 }, () => 9))
      const stranger = yield* iPhoneApi(withKey.token, { privateKey: other.privateKey })
      expect(yield* Effect.flip(stranger.devices.preferences())).toMatchObject(refused("forged"))
      // Its name is what it was: nothing of a refused request is done.
      const mine = yield* iPhoneApi(withKey.token, { privateKey: key.privateKey })
      yield* mine.devices.update({ payload: { timeZone: "Europe/Paris" } })
    }).pipe(Effect.provide(TestApp)))

  it.effect("isn't answered when its clock is off: it is told so, and is still paired", () =>
    Effect.gen(function*() {
      const { withKey } = yield* paired
      const late = now - RequestSignature.signatureWindowMs - 1
      const slow = yield* iPhoneApi(withKey.token, { privateKey: key.privateKey, clock: late })
      const answer = yield* Effect.flip(slow.devices.preferences())
      expect(answer).toMatchObject(refused("clock"))
      // Not Unauthorized, which the app reads as "this iPhone was removed".
      expect(answer._tag).not.toBe("Unauthorized")
      const onTime = yield* iPhoneApi(withKey.token, { privateKey: key.privateKey })
      expect(yield* onTime.devices.preferences()).toHaveProperty("flows")
    }).pipe(Effect.provide(TestApp)))

  it.effect("a wrong token is Unauthorized whatever it signs", () =>
    Effect.gen(function*() {
      const { withKey } = yield* paired
      const wrong = yield* iPhoneApi(`${withKey.token}x`, { privateKey: key.privateKey })
      expect((yield* Effect.flip(wrong.devices.preferences()))._tag).toBe("Unauthorized")
    }).pipe(Effect.provide(TestApp)))
})

describe("an iPhone paired without a device key", () => {
  it.effect("is known by its token alone, as before, until it is paired again", () =>
    Effect.gen(function*() {
      const { without } = yield* paired
      const iPhone = yield* iPhoneApi(without.token)
      expect(yield* iPhone.devices.preferences()).toHaveProperty("flows")
      yield* iPhone.devices.update({ payload: { name: "Still here" } })
    }).pipe(Effect.provide(TestApp)))

  it.effect("can't use another iPhone's key to pass for it", () =>
    Effect.gen(function*() {
      const { withKey, without } = yield* paired
      const iPhone = yield* iPhoneApi(without.token, { privateKey: key.privateKey })
      // Signed or not, it is itself: the headers of an iPhone without a key are not read.
      yield* iPhone.devices.update({ payload: { name: "Signed for nothing" } })
      const asOther = yield* iPhoneApi(withKey.token)
      expect(yield* Effect.flip(asOther.devices.preferences())).toMatchObject(refused("unsigned"))
    }).pipe(Effect.provide(TestApp)))
})

describe("pairing with a device key", () => {
  it.effect("refuses a key that isn't one, and keeps the code for the next try", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices"])
      const qr = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      for (const deviceKey of ["", "not a key", key.publicKey.slice(0, 20), `${key.publicKey}AAAA`]) {
        const exit = yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code: qr.code, deviceKey } }))
        expect(exit._tag).toBe("Failure")
      }
      expect((yield* api.console.devices()).length).toBe(0)
      const paired = yield* api.devices.pair({ payload: { ...iphone, code: qr.code, deviceKey: key.publicKey } })
      expect(paired.token).toContain(".")
    }).pipe(Effect.provide(TestApp)))
})
