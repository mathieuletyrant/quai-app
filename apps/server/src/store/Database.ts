import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Config, Effect, Layer } from "effect"
import { Migrator, SqlClient } from "effect/sql"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

/** Schema changes, in order. Never edit a shipped migration: add the next one. */
export const migrations = Migrator.fromRecord({
  "0001_devices": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      apns_environment TEXT NOT NULL CHECK (apns_environment IN ('development', 'production')),
      push_to_start_token TEXT,
      paired_at INTEGER NOT NULL,
      last_seen_at INTEGER
    )`
    yield* sql`CREATE TABLE activity_tokens (
      device_id TEXT NOT NULL,
      media_key TEXT NOT NULL,
      push_token TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (device_id, media_key)
    )`
    yield* sql`CREATE TABLE pairing_codes (
      code_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )`
    yield* sql`CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  }),
  "0002_device_preferences": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE devices ADD COLUMN preferences TEXT`
  })
})

/** SQLite at `filename` (":memory:" in tests), migrated. */
export const layerFile = (filename: string) =>
  SqliteMigrator.layer({ loader: migrations }).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename }))
  )

/** The database in `QUAI_DATA_DIR` (default `./data`). */
export const layer = Layer.unwrap(
  Effect.gen(function*() {
    const dir = yield* Config.String("QUAI_DATA_DIR").pipe(Config.withDefault("./data"))
    mkdirSync(dir, { recursive: true })
    return layerFile(join(dir, "quai.db"))
  })
)
