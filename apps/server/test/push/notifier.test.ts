import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { DownloadActivities } from "../../src/engine/DownloadActivities.ts"
import { Apns } from "../../src/push/Apns.ts"
import { Notifier } from "../../src/push/Notifier.ts"
import * as Database from "../../src/store/Database.ts"
import { Devices } from "../../src/store/Devices.ts"
import { fakeApns } from "./fakeApns.ts"

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
        const mathieu = yield* pairPhone("Mathieu", "development", "pts-mathieu")
        yield* pairPhone("Julie", "production", "pts-julie")
        const engine = yield* DownloadActivities
        const notifier = yield* Notifier
        const devices = yield* Devices

        yield* notifier.send(yield* engine.handle({ _tag: "Added", mediaKey: "movie:tmdb:1", title: "Dune" }))
        expect(dev.hits.map((h) => h.path)).toEqual(["/3/device/pts-mathieu"])
        expect(prod.hits.map((h) => h.path)).toEqual(["/3/device/pts-julie"])

        const start = dev.hits[0]!
        expect(start.headers["apns-push-type"]).toBe("liveactivity")
        expect(start.headers["apns-topic"]).toBe("com.mathieuletyrant.quai.push-type.liveactivity")
        expect(start.headers["apns-priority"]).toBe("10")
        expect(start.body.aps).toMatchObject({
          event: "start",
          "attributes-type": "DownloadActivityAttributes",
          attributes: { mediaKey: "movie:tmdb:1", title: "Dune" },
          "content-state": { step: "searching", stalled: false },
          alert: { title: "Dune" }
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
        yield* devices.setActivityToken(mathieu, "movie:tmdb:1", "act-mathieu")
        yield* notifier.send(yield* engine.handle({ _tag: "Grabbed", mediaKey: "movie:tmdb:1", title: "Dune", downloadId: "h" }))
        expect(dev.hits[1]!.path).toBe("/3/device/act-mathieu")
        expect(dev.hits[1]!.body.aps).toMatchObject({ event: "update", "content-state": { step: "downloading" } })
        expect(prod.hits).toHaveLength(1)

        // Progress within a step is low priority.
        yield* TestClock.adjust("20 seconds")
        yield* notifier.send(yield* engine.handle({ _tag: "Progress", downloadId: "h", progress: 0.5, bytesPerSecond: 1, remainingSeconds: 9 }))
        expect(dev.hits[2]!.headers["apns-priority"]).toBe("5")

        yield* notifier.send(yield* engine.handle({ _tag: "Available", mediaKey: "movie:tmdb:1" }))
        expect(dev.hits[3]!.body.aps.event).toBe("end")
        expect(dev.hits[3]!.body.aps["dismissal-date"] - dev.hits[3]!.body.aps.timestamp).toBe(15 * 60)
      }).pipe(Effect.provide(Notifier.layer.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }).pipe(
      Effect.provide(Layer.mergeAll(Devices.layer, DownloadActivities.layer).pipe(
        Layer.provideMerge(Database.layerFile(":memory:"))
      )),
      Effect.scoped
    ))

  it.live("forgets a token APNs says is gone", () =>
    Effect.gen(function*() {
      const dev = yield* fakeApns
      const apns = yield* Apns.make(
        { keyPem: Redacted.make(keyPem), keyId: "K", teamId: "T", topic: "com.mathieuletyrant.quai" },
        { development: dev.url, production: dev.url }
      )
      yield* Effect.gen(function*() {
        yield* pairPhone("Old iPhone", "development", "dead-token")
        const engine = yield* DownloadActivities
        yield* (yield* Notifier).send(yield* engine.handle({ _tag: "Added", mediaKey: "m", title: "T" }))
        expect(dev.hits).toHaveLength(1)
        expect(yield* (yield* Devices).startRecipients).toEqual([])
      }).pipe(Effect.provide(Notifier.layer.pipe(Layer.provide(Layer.succeed(Apns, apns)))))
    }).pipe(
      Effect.provide(Layer.mergeAll(Devices.layer, DownloadActivities.layer).pipe(
        Layer.provideMerge(Database.layerFile(":memory:"))
      )),
      Effect.scoped
    ))
})
