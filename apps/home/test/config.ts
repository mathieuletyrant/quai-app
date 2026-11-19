import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Redacted } from "effect"
import { RelayConfig } from "../src/Config.ts"

const key = Redacted.make("masked")

/** Every service configured, with fake hosts. */
export const testConfig = {
  coreUrl: "ws://core/relay",
  port: 8788,
  dataDir: "/nonexistent",
  internalUrl: "http://quai-relay:8788",
  radarr: { url: "http://radarr:7878", apiKey: key },
  sonarr: { url: "http://sonarr:8989", apiKey: key },
  qbittorrent: { url: "http://qbittorrent:8080", username: "admin", password: Redacted.make("pw") },
  jellyfin: { url: "http://jellyfin:8096", apiKey: key }
} satisfies RelayConfig["Service"]

export const configLayer = (overrides: Partial<RelayConfig["Service"]> = {}) =>
  Layer.succeed(RelayConfig, { ...testConfig, ...overrides })

/** A fresh temporary directory, removed when the test's scope closes. */
export const tempDir = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.makeTempDirectoryScoped({ prefix: "quai-relay-" })
})

export { NodeFileSystem }
