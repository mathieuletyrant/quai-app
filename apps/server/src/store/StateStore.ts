import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

/**
 * Small JSON documents that must survive a restart (the running activities, what Jellyfin is
 * awaited for). Without it, an update restarts Quai mid-download and leaves the iPhones with
 * activities nobody updates anymore.
 */
export class StateStore extends Context.Service<StateStore, {
  readonly load: (key: string) => Effect.Effect<unknown>
  readonly save: (key: string, value: unknown) => Effect.Effect<void>
}>()("quai/StateStore") {
  static readonly layer = Layer.effect(
    StateStore,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return {
        load: (key) =>
          Effect.map(sql`SELECT value FROM settings WHERE key = ${`state:${key}`}`, (rows) => {
            const value = rows[0]?.["value"]
            if (typeof value !== "string") return undefined
            try {
              return JSON.parse(value) as unknown
            } catch {
              return undefined
            }
          }).pipe(Effect.orDie),
        save: (key, value) =>
          sql`INSERT INTO settings (key, value) VALUES (${`state:${key}`}, ${JSON.stringify(value)})
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`.pipe(Effect.asVoid, Effect.orDie)
      }
    })
  )

  /** Keeps nothing: for tests and runs without a database. */
  static readonly memory = Layer.sync(StateStore, () => {
    const values = new Map<string, string>()
    return {
      load: (key) => Effect.sync(() => {
        const value = values.get(key)
        return value === undefined ? undefined : JSON.parse(value) as unknown
      }),
      save: (key, value) => Effect.sync(() => void values.set(key, JSON.stringify(value)))
    }
  })
}
