import type { ApnsEnvironment, DeviceId } from "@quai/api"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { createHash, randomBytes, randomUUID } from "node:crypto"

export const Timing = {
  /** A pairing code (the console's QR code) is valid this long, and only once. */
  pairingCodeMs: 10 * 60_000
} as const

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** 8 characters, no look-alikes (0/O, 1/I/L), easy to type when the camera can't scan. */
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const newCode = () =>
  Array.from(randomBytes(8), (b) => codeAlphabet[b % codeAlphabet.length]).join("")

export interface Device {
  readonly id: DeviceId
  readonly name: string
  readonly apnsEnvironment: ApnsEnvironment
  readonly pushToStartToken: string | null
  readonly pairedAt: number
  readonly lastSeenAt: number | null
}

/** Where a push for one activity goes: one row per iPhone that can receive it. */
export interface Recipient {
  readonly deviceId: DeviceId
  readonly apnsEnvironment: ApnsEnvironment
  readonly token: string
}

const DeviceRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  apns_environment: Schema.Literals(["development", "production"]),
  push_to_start_token: Schema.NullOr(Schema.String),
  paired_at: Schema.Number,
  last_seen_at: Schema.NullOr(Schema.Number)
})

const toDevice = (row: typeof DeviceRow.Type): Device => ({
  id: row.id as DeviceId,
  name: row.name,
  apnsEnvironment: row.apns_environment,
  pushToStartToken: row.push_to_start_token,
  pairedAt: row.paired_at,
  lastSeenAt: row.last_seen_at
})

export class Devices extends Context.Service<Devices, {
  readonly createPairingCode: Effect.Effect<{ readonly code: string; readonly expiresAt: number }>
  /** Spends a pairing code; `None` when it is unknown, used or expired. */
  readonly pair: (input: {
    readonly code: string
    readonly name: string
    readonly apnsEnvironment: ApnsEnvironment
    readonly pushToStartToken: string | null
  }) => Effect.Effect<Option.Option<{ readonly deviceId: DeviceId; readonly token: string }>>
  readonly authenticate: (token: string) => Effect.Effect<Option.Option<Device>>
  readonly update: (
    id: DeviceId,
    patch: { readonly name?: string | undefined; readonly pushToStartToken?: string | null | undefined }
  ) => Effect.Effect<void>
  readonly setActivityToken: (id: DeviceId, mediaKey: string, pushToken: string) => Effect.Effect<void>
  readonly list: Effect.Effect<ReadonlyArray<Device>>
  readonly remove: (id: DeviceId) => Effect.Effect<boolean>
  /** iPhones that can be woken with push-to-start. */
  readonly startRecipients: Effect.Effect<ReadonlyArray<Recipient>>
  /** iPhones that told us the push token of this activity. */
  readonly activityRecipients: (mediaKey: string) => Effect.Effect<ReadonlyArray<Recipient>>
  /** APNs said this token is dead: forget it. */
  readonly dropToken: (token: string) => Effect.Effect<void>
}>()("quai/Devices") {
  static readonly layer = Layer.effect(
    Devices,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const decodeRows = Schema.decodeUnknownSync(Schema.Array(DeviceRow))
      // The schema is ours: a row that doesn't decode is a bug, not a recoverable error.
      const orDie = <A, E>(effect: Effect.Effect<A, E>) => Effect.orDie(effect)

      return {
        createPairingCode: orDie(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const code = newCode()
          const expiresAt = now + Timing.pairingCodeMs
          yield* sql`DELETE FROM pairing_codes WHERE expires_at < ${now}`
          yield* sql`INSERT INTO pairing_codes (code_hash, expires_at) VALUES (${sha256(code)}, ${expiresAt})`
          return { code, expiresAt }
        })),

        pair: (input) =>
          orDie(sql.withTransaction(Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const code = input.code.trim().toUpperCase()
            const spent = yield* sql`UPDATE pairing_codes SET used_at = ${now}
              WHERE code_hash = ${sha256(code)} AND used_at IS NULL AND expires_at >= ${now}
              RETURNING code_hash`
            if (spent.length === 0) return Option.none()
            const deviceId = randomUUID() as DeviceId
            const token = randomBytes(32).toString("base64url")
            yield* sql`INSERT INTO devices (id, name, token_hash, apns_environment, push_to_start_token, paired_at, last_seen_at)
              VALUES (${deviceId}, ${input.name}, ${sha256(token)}, ${input.apnsEnvironment}, ${input.pushToStartToken}, ${now}, ${now})`
            return Option.some({ deviceId, token })
          }))),

        authenticate: (token) =>
          orDie(Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const rows = decodeRows(
              yield* sql`UPDATE devices SET last_seen_at = ${now} WHERE token_hash = ${sha256(token)} RETURNING *`
            )
            return Option.map(Option.fromNullishOr(rows[0]), toDevice)
          })),

        update: (id, patch) =>
          orDie(Effect.gen(function*() {
            if (patch.name !== undefined) yield* sql`UPDATE devices SET name = ${patch.name} WHERE id = ${id}`
            if (patch.pushToStartToken !== undefined) {
              yield* sql`UPDATE devices SET push_to_start_token = ${patch.pushToStartToken} WHERE id = ${id}`
            }
          })),

        setActivityToken: (id, mediaKey, pushToken) =>
          orDie(Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            yield* sql`INSERT INTO activity_tokens (device_id, media_key, push_token, updated_at)
              VALUES (${id}, ${mediaKey}, ${pushToken}, ${now})
              ON CONFLICT (device_id, media_key) DO UPDATE SET push_token = excluded.push_token, updated_at = excluded.updated_at`
          })),

        list: orDie(Effect.map(sql`SELECT * FROM devices ORDER BY paired_at`, (rows) => decodeRows(rows).map(toDevice))),

        remove: (id) =>
          orDie(sql.withTransaction(Effect.gen(function*() {
            yield* sql`DELETE FROM activity_tokens WHERE device_id = ${id}`
            const removed = yield* sql`DELETE FROM devices WHERE id = ${id} RETURNING id`
            return removed.length > 0
          }))),

        startRecipients: orDie(Effect.map(
          sql`SELECT id, apns_environment, push_to_start_token FROM devices WHERE push_to_start_token IS NOT NULL`,
          (rows) =>
            rows.map((r) => ({
              deviceId: r["id"] as DeviceId,
              apnsEnvironment: r["apns_environment"] as ApnsEnvironment,
              token: r["push_to_start_token"] as string
            }))
        )),

        activityRecipients: (mediaKey) =>
          orDie(Effect.map(
            sql`SELECT d.id, d.apns_environment, t.push_token FROM activity_tokens t
              JOIN devices d ON d.id = t.device_id WHERE t.media_key = ${mediaKey}`,
            (rows) =>
              rows.map((r) => ({
                deviceId: r["id"] as DeviceId,
                apnsEnvironment: r["apns_environment"] as ApnsEnvironment,
                token: r["push_token"] as string
              }))
          )),

        dropToken: (token) =>
          orDie(Effect.gen(function*() {
            yield* sql`DELETE FROM activity_tokens WHERE push_token = ${token}`
            yield* sql`UPDATE devices SET push_to_start_token = NULL WHERE push_to_start_token = ${token}`
          }))
      }
    })
  )
}
