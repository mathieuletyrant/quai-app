import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { randomBytes } from "node:crypto"

/** Small server-wide values that must survive restarts. */
export class Settings extends Context.Service<Settings, {
  /** The secret the *arr webhooks carry in their URL, generated on first start. */
  readonly webhookToken: string
}>()("quai/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fresh = randomBytes(24).toString("base64url")
      yield* sql`INSERT INTO settings (key, value) VALUES ('webhook_token', ${fresh}) ON CONFLICT (key) DO NOTHING`
      const rows = yield* sql`SELECT value FROM settings WHERE key = 'webhook_token'`
      return { webhookToken: String(rows[0]!["value"]) }
    }).pipe(Effect.orDie)
  )
}
