import type { PushSettings } from "@quai/api"
import { InvalidPushKey } from "@quai/api"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { createCipheriv, createDecipheriv, createPrivateKey, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Apns, type ApnsCredentials } from "../push/Apns.ts"

/**
 * The Apple push key is encrypted with a key kept in its own file next to the database, so a copy
 * of the database alone (a backup, a log of rows) doesn't give the push key away.
 */
const loadSecret = (file: string) => {
  if (existsSync(file)) return readFileSync(file)
  mkdirSync(dirname(file), { recursive: true })
  const secret = randomBytes(32)
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

export const encrypt = (secret: Buffer, plain: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", secret, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")
}

export const decrypt = (secret: Buffer, sealed: string) => {
  const raw = Buffer.from(sealed, "base64")
  const decipher = createDecipheriv("aes-256-gcm", secret, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")
}

/** An APNs key is an EC P-256 private key in PKCS#8 PEM; anything else would only fail at the first push. */
export const checkKey = (pem: string) => {
  try {
    const key = createPrivateKey(pem.trim())
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
  } catch {
    return false
  }
}

interface Stored {
  readonly source: "console" | "environment"
  readonly credentials: ApnsCredentials
}

export class PushKey extends Context.Service<PushKey, {
  readonly settings: Effect.Effect<typeof PushSettings.Type>
  readonly save: (input: { readonly keyPem: string; readonly keyId: string; readonly teamId: string }) => Effect.Effect<typeof PushSettings.Type, InvalidPushKey>
  readonly remove: Effect.Effect<typeof PushSettings.Type>
}>()("quai/PushKey") {
  static readonly make = (secretFile: string) =>
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const apns = yield* Apns
      const secret = loadSecret(secretFile)
      const topic = yield* Config.String("QUAI_APNS_TOPIC").pipe(Config.withDefault("com.mathieuletyrant.quai"), Effect.orDie)

      // For plain Docker installs: QUAI_APNS_KEY_FILE (or QUAI_APNS_KEY), QUAI_APNS_KEY_ID, QUAI_APNS_TEAM_ID.
      const fromEnvironment = Effect.gen(function*() {
        const file = yield* Config.option(Config.String("QUAI_APNS_KEY_FILE"))
        const inline = yield* Config.option(Config.Redacted("QUAI_APNS_KEY"))
        const keyId = yield* Config.option(Config.String("QUAI_APNS_KEY_ID"))
        const teamId = yield* Config.option(Config.String("QUAI_APNS_TEAM_ID"))
        // A key file that isn't there yet means "no pushes", not a crash.
        const keyPem = Option.isSome(inline)
          ? Option.some(inline.value)
          : Option.flatMap(file, (path) =>
            existsSync(path) ? Option.some(Redacted.make(readFileSync(path, "utf8"))) : Option.none())
        return Option.isSome(keyPem) && Option.isSome(keyId) && Option.isSome(teamId)
          ? { keyPem: keyPem.value, keyId: keyId.value, teamId: teamId.value, topic }
          : null
      }).pipe(Effect.orDie)

      const fromConsole = Effect.gen(function*() {
        const rows = yield* sql`SELECT key, value FROM settings WHERE key IN ('apns_key', 'apns_key_id', 'apns_team_id')`
        const value = (k: string) => rows.find((r) => r["key"] === k)?.["value"] as string | undefined
        const sealed = value("apns_key")
        const keyId = value("apns_key_id")
        const teamId = value("apns_team_id")
        if (sealed === undefined || keyId === undefined || teamId === undefined) return null
        return { keyPem: Redacted.make(decrypt(secret, sealed)), keyId, teamId, topic }
      }).pipe(Effect.orDie)

      const current = Effect.gen(function*(): Effect.fn.Return<Stored | null> {
        const saved = yield* fromConsole
        if (saved !== null) return { source: "console", credentials: saved }
        const env = yield* fromEnvironment
        return env === null ? null : { source: "environment", credentials: env }
      })

      const describe = (stored: Stored | null): typeof PushSettings.Type =>
        stored === null
          ? { configured: false, topic }
          : {
            configured: true,
            source: stored.source,
            keyId: stored.credentials.keyId,
            teamId: stored.credentials.teamId,
            topic
          }

      const apply = Effect.gen(function*() {
        const stored = yield* current
        yield* apns.use(stored?.credentials ?? null)
        yield* Effect.logInfo(
          stored === null ? "No APNs key: Live Activities won't be pushed" : `APNs key ${stored.credentials.keyId} (${stored.source})`
        )
        return describe(stored)
      })

      yield* apply

      return {
        settings: Effect.map(current, describe),
        save: (input: { readonly keyPem: string; readonly keyId: string; readonly teamId: string }) =>
          Effect.gen(function*() {
            const keyPem = input.keyPem.trim()
            const keyId = input.keyId.trim()
            const teamId = input.teamId.trim()
            if (!checkKey(keyPem)) {
              return yield* Effect.fail(new InvalidPushKey({ message: "This isn't an Apple push key (.p8)." }))
            }
            if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) {
              return yield* Effect.fail(new InvalidPushKey({ message: "The key id and team id are 10 letters or digits." }))
            }
            yield* sql.withTransaction(Effect.gen(function*() {
              for (const [key, value] of [["apns_key", encrypt(secret, keyPem)], ["apns_key_id", keyId], ["apns_team_id", teamId]]) {
                yield* sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`
              }
            })).pipe(Effect.orDie)
            return yield* apply
          }),
        remove: Effect.gen(function*() {
          yield* sql`DELETE FROM settings WHERE key IN ('apns_key', 'apns_key_id', 'apns_team_id')`.pipe(Effect.orDie)
          return yield* apply
        })
      }
    })

  /** The secret sits in `QUAI_DATA_DIR` (default `./data`), next to the database. */
  static readonly layer = Layer.effect(
    PushKey,
    Effect.gen(function*() {
      const dir = yield* Config.String("QUAI_DATA_DIR").pipe(Config.withDefault("./data"), Effect.orDie)
      return yield* PushKey.make(join(dir, "secret.key"))
    })
  )
}
