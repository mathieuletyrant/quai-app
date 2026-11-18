import { QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { HttpApiTest } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { generateKeyPairSync } from "node:crypto"
import { Apns } from "../../src/push/Apns.ts"
import { TestApp } from "../testApp.ts"

const pem = (curve: string) =>
  generateKeyPairSync("ec", { namedCurve: curve }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()

describe("push key from the console", () => {
  it.effect("saves a valid key, encrypted, and uses it at once", () =>
    Effect.gen(function*() {
      const api = yield* HttpApiTest.groups(QuaiApi, ["push"])
      const apns = yield* Apns
      expect(yield* api.push.pushSettings()).toEqual({ configured: false, topic: "com.mathieuletyrant.quai" })
      expect(yield* apns.configured).toBe(false)

      const key = pem("prime256v1")
      const saved = yield* api.push.savePushKey({ payload: { keyPem: `\n${key}\n`, keyId: "72YS3G4HXU", teamId: "FFGWB5G2PN" } })
      expect(saved).toEqual({
        configured: true,
        source: "console",
        keyId: "72YS3G4HXU",
        teamId: "FFGWB5G2PN",
        topic: "com.mathieuletyrant.quai"
      })
      expect(yield* apns.configured).toBe(true)

      // Stored encrypted: the database never holds the PEM.
      const rows = yield* (yield* SqlClient.SqlClient)`SELECT value FROM settings WHERE key = 'apns_key'`
      const stored = String(rows[0]!["value"])
      expect(stored).not.toContain("PRIVATE KEY")
      expect(stored).not.toContain(key.split("\n")[1]!)

      const removed = yield* api.push.removePushKey()
      expect(removed.configured).toBe(false)
      expect(yield* apns.configured).toBe(false)
    }).pipe(Effect.provide(TestApp)))

  it.effect("refuses what isn't an Apple push key", () =>
    Effect.gen(function*() {
      const api = yield* HttpApiTest.groups(QuaiApi, ["push"])
      const save = (keyPem: string, keyId = "72YS3G4HXU") =>
        Effect.exit(api.push.savePushKey({ payload: { keyPem, keyId, teamId: "FFGWB5G2PN" } }))
      expect(Exit.isFailure(yield* save("not a key"))).toBe(true)
      expect(Exit.isFailure(yield* save(pem("secp384r1")))).toBe(true)
      expect(Exit.isFailure(yield* save(pem("prime256v1"), "too-short"))).toBe(true)
      expect((yield* api.push.pushSettings()).configured).toBe(false)
    }).pipe(Effect.provide(TestApp)))
})
