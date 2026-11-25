import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { Activities } from "../../src/flows/Activities.ts"
import { Devices } from "../../src/home/Devices.ts"
import { Integrations } from "../../src/integrations/Integration.ts"
import { Apns } from "../../src/push/Apns.ts"
import { Notifier } from "../../src/push/Notifier.ts"
import { cloud, makeFakeHome } from "../fakeHome.ts"
import { ev } from "../flows/helpers.ts"
import { fakeApns } from "./fakeApns.ts"

/** The Cloud on a connected fake home, pushing through `apns`. */
const onHome = (apns: Apns["Service"]) =>
  cloud(Layer.succeed(Integrations, [])).pipe(Layer.provide(Layer.succeed(Apns, apns)))

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()

const pairPhone = (name: string, apnsEnvironment: "development" | "production", pushToStartToken: string) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    const { code } = yield* devices.createPairingCode
    const paired = yield* devices.pair({ code, name, apnsEnvironment, pushToStartToken })
    if (paired._tag === "None") return yield* Effect.die("pairing failed")
    return paired.value.deviceId
  })

describe("push to APNs", () => {
  it.effect("start goes to every push-to-start token, updates to the activity's token, on each iPhone's server", () =>
    Effect.gen(function*() {
      const dev = yield* fakeApns
      const prod = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "KEY123", teamId: "TEAM456", topic: "com.mathieuletyrant.quai" },
        { development: dev.url, production: prod.url }
      )
      yield* Effect.gen(function*() {
        yield* Effect.flatMap(makeFakeHome(), (home) => home.connect)
        const mathieu = yield* pairPhone("Mathieu", "development", "pts-mathieu")
        yield* pairPhone("Julie", "production", "pts-julie")
        const engine = yield* Activities
        const notifier = yield* Notifier
        const devices = yield* Devices

        yield* notifier.send(yield* engine.handle(ev.added()))
        expect(dev.hits.map((hit) => hit.path)).toEqual(["/3/device/pts-mathieu"])
        expect(prod.hits.map((hit) => hit.path)).toEqual(["/3/device/pts-julie"])

        const start = dev.hits[0]!
        expect(start.headers["apns-push-type"]).toBe("liveactivity")
        expect(start.headers["apns-topic"]).toBe("com.mathieuletyrant.quai.push-type.liveactivity")
        expect(start.headers["apns-priority"]).toBe("10")
        expect(start.body.aps).toMatchObject({
          event: "start",
          "attributes-type": "QuaiActivityAttributes",
          attributes: { key: "download|movie:tmdb:1", flowId: "download", title: "Dune", color: "#FFC230" },
          "content-state": { step: 0, tone: "active" },
          alert: { title: "Dune", body: "Searching" }
        })

        // The provider token is a valid ES256 JWT from our key.
        const [header, claims, signature] = String(start.headers["authorization"]).replace("bearer ", "").split(".")
        expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123" })
        expect(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss).toBe("TEAM456")
        expect(verify("sha256", Buffer.from(`${header}.${claims}`), {
          key: createPublicKey(privateKey),
          dsaEncoding: "ieee-p1363"
        }, Buffer.from(signature!, "base64url"))).toBe(true)

        // Only Mathieu's iPhone reported the activity's token: only it gets the update.
        yield* devices.setActivityToken(mathieu, "download|movie:tmdb:1", "act-mathieu")
        yield* notifier.send(yield* engine.handle(ev.grabbed("h")))
        expect(dev.hits[1]!.path).toBe("/3/device/act-mathieu")
        expect(dev.hits[1]!.body.aps).toMatchObject({ event: "update", "content-state": { step: 1 } })
        expect(prod.hits).toHaveLength(1)

        // Progress goes at high priority too: low priority let iOS hold updates back.
        yield* TestClock.adjust("20 seconds")
        yield* notifier.send(yield* engine.handle(ev.progress(0.5, "h")))
        expect(dev.hits[2]!.headers["apns-priority"]).toBe("10")

        yield* notifier.send(yield* engine.handle(ev.available()))
        expect(dev.hits[3]!.body.aps.event).toBe("end")
        expect(dev.hits[3]!.body.aps["dismissal-date"] - dev.hits[3]!.body.aps.timestamp).toBe(15 * 60)
      }).pipe(Effect.provide(onHome(apns)))
    }).pipe(Effect.scoped))

  it.live("forgets a token APNs says is gone", () =>
    Effect.gen(function*() {
      const dev = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: dev.url, production: dev.url }
      )
      yield* Effect.gen(function*() {
        yield* Effect.flatMap(makeFakeHome(), (home) => home.connect)
        yield* pairPhone("Old iPhone", "development", "dead-token")
        const engine = yield* Activities
        yield* (yield* Notifier).send(yield* engine.handle(ev.added()))
        expect(dev.hits).toHaveLength(1)
        expect(yield* (yield* Devices).startRecipients).toEqual([])
      }).pipe(Effect.provide(onHome(apns)))
    }).pipe(Effect.scoped))

  it.effect("tries a push APNs never answers once more on a new connection, then gives up and reconnects for the next one", () =>
    Effect.gen(function*() {
      const dev = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: dev.url, production: dev.url }
      )
      const push = (deviceToken: string) =>
        apns.send({ environment: "development", deviceToken, body: {}, priority: 10 })
      const stuck = yield* Effect.forkChild(push("silent-token"))
      yield* untilReal(() => dev.hits.length === 1)
      yield* TestClock.adjust("10 seconds")
      // The first connection is dropped and the push sent again on a second one.
      yield* untilReal(() => dev.hits.length === 2)
      expect(dev.connections()).toBe(2)
      expect(stuck.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("10 seconds")
      const error = yield* Effect.flip(Fiber.join(stuck))
      expect(error.reason).toBe("no answer within 10 s")
      yield* push("live-token")
      expect(dev.hits).toHaveLength(3)
      expect(dev.connections()).toBe(3)
    }).pipe(Effect.scoped))

  it.effect("opens a new connection for a push after 5 idle minutes, and reuses a busy one", () =>
    Effect.gen(function*() {
      const dev = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: dev.url, production: dev.url }
      )
      const push = apns.send({ environment: "development", deviceToken: "live-token", body: {}, priority: 10 })
      yield* push
      yield* TestClock.adjust("4 minutes")
      yield* push
      expect(dev.connections()).toBe(1)
      yield* TestClock.adjust("5 minutes")
      yield* push
      expect(dev.hits).toHaveLength(3)
      expect(dev.connections()).toBe(2)
    }).pipe(Effect.scoped))
})

/** Waits, in real time, for the fake server to see what a forked send did. */
const untilReal = (done: () => boolean): Effect.Effect<void> =>
  done() ? Effect.void : Effect.callback<void>((resume) => void setTimeout(() => resume(Effect.void), 5)).pipe(
    Effect.andThen(() => untilReal(done))
  )
