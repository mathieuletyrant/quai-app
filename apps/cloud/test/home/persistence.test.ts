import { DeviceAuth, QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { TestClock } from "effect/testing"
import { createHash } from "node:crypto"
import { Activities } from "../../src/flows/Activities.ts"
import { makeFakeHome } from "../fakeHome.ts"
import { TestApp } from "../testApp.ts"

const signedIn = (token: string) =>
  HttpApiTest.groups(QuaiApi, ["devices"]).pipe(
    Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) => next(HttpClientRequest.bearerToken(request, token))))
  )

const iphone = { name: "iPhone", apnsEnvironment: "development" as const, pushToStartToken: "pts" }

const failureTag = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(effect), (exit) => Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "success")

describe("no home connected", () => {
  it.effect("the app's and the console's routes answer 503 HomeOffline; health and push settings still answer", () =>
    Effect.gen(function*() {
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices", "flows", "system", "push"])
      expect((yield* Effect.flip(api.console.devices()))._tag).toBe("HomeOffline")
      expect(yield* Effect.flip(api.flows.list())).toMatchObject({ _tag: "HomeOffline", message: "Quai Home is not connected" })
      expect((yield* Effect.flip(api.devices.pair({ payload: { ...iphone, code: "ABCDEFGH" } })))._tag).toBe("HomeOffline")
      const phone = yield* signedIn("some-token")
      expect((yield* Effect.flip(phone.devices.activities()))._tag).toBe("HomeOffline")
      expect((yield* api.system.health()).status).toBe("ok")
      expect(yield* api.push.pushSettings()).toEqual({ configured: false, topic: "com.mathieuletyrant.quai" })
    }).pipe(Effect.provide(TestApp)))

  it.effect("a home that goes away takes the routes with it", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const api = yield* HttpApiTest.groups(QuaiApi, ["console"])
      expect(yield* api.console.devices()).toEqual([])
      yield* home.disconnect
      expect(yield* failureTag(api.console.devices())).toContain("HomeOffline")
    }).pipe(Effect.provide(TestApp)))
})

describe("everything lives at home", () => {
  it.effect("pairing, device auth, preferences, flow edits and activities survive a Cloud restart", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()

      // First Cloud: pair, set preferences, edit a flow, start an activity.
      const { deviceId, token, code } = yield* Effect.gen(function*() {
        yield* home.connect
        const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices", "flows"])
        const qr = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
        const unused = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
        const paired = yield* api.devices.pair({ payload: { ...iphone, code: qr.code } })
        const phone = yield* signedIn(paired.token)
        yield* phone.devices.savePreferences({ payload: { flows: { download: { enabled: true, hiddenSteps: ["searching"] } } } })
        yield* phone.devices.activityToken({ payload: { mediaKey: "download|movie:tmdb:1", pushToken: "act-1" } })
        const download = (yield* api.flows.list()).find((flow) => flow.id === "download")!
        yield* api.flows.save({ params: { id: "download" }, payload: { ...download, color: "#123456" } })
        yield* api.flows.save({ params: { id: "anime" }, payload: { ...download, id: "anime", name: "Anime", filter: { mediaType: "series" } } })
        yield* (yield* Activities).handle({ type: "media.added", subject: { kind: "media", key: "movie:tmdb:1", title: "Dune", mediaType: "movie" } })
        return { ...paired, code: unused.code }
      }).pipe(Effect.provide(TestApp))

      // What Quai Home keeps: documents, the token as a hash only.
      const device = home.documents.get(`devices/${deviceId}`) as Record<string, unknown>
      expect(device["tokenHash"]).toBe(createHash("sha256").update(token).digest("hex"))
      expect(JSON.stringify([...home.documents])).not.toContain(token)
      expect([...home.documents.keys()].sort()).toEqual([
        `devices/${deviceId}`,
        "flows/anime",
        "flows/download",
        `pairing/${createHash("sha256").update(code).digest("hex")}`,
        "state/activities"
      ])

      // A new Cloud, nothing carried over but the home.
      yield* Effect.gen(function*() {
        yield* home.connect
        const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices", "flows"])
        const phone = yield* signedIn(token)
        expect((yield* phone.devices.preferences()).flows["download"]?.hiddenSteps).toEqual(["searching"])
        expect((yield* api.console.devices()).map((paired) => paired.id)).toEqual([deviceId])
        const flows = yield* api.flows.list()
        expect(flows.find((flow) => flow.id === "download")?.color).toBe("#123456")
        expect(flows.map((flow) => flow.id)).toEqual(["download", "playback", "request", "today", "anime"])
        const { activities } = yield* (yield* Activities).snapshot
        expect([...activities.values()].map((activity) => [activity.title, activity.stepIndex])).toEqual([["Dune", 0]])
        // The unused code still pairs, within its 10 minutes; then it is spent.
        yield* api.devices.pair({ payload: { ...iphone, code } })
        expect(Exit.isFailure(yield* Effect.exit(api.devices.pair({ payload: { ...iphone, code } })))).toBe(true)
        expect(yield* api.console.devices()).toHaveLength(2)
        // A removed iPhone is gone from the home too.
        yield* api.console.removeDevice({ params: { id: deviceId } })
        expect(home.documents.has(`devices/${deviceId}`)).toBe(false)
        expect(Exit.isFailure(yield* Effect.exit(phone.devices.preferences()))).toBe(true)
      }).pipe(Effect.provide(TestApp))
    }))

  it.effect("an expired pairing code is refused and cleaned up", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "devices"])
      const old = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      yield* TestClock.adjust("11 minutes")
      yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      expect([...home.documents.keys()].filter((key) => key.startsWith("pairing/"))).toHaveLength(1)
      expect((yield* Effect.flip(api.devices.pair({ payload: { ...iphone, code: old.code } })))._tag).toBe("InvalidPairingCode")
    }).pipe(Effect.provide(TestApp)))
})
