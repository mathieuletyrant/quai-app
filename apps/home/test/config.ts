import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Redacted } from "effect"
import { join } from "node:path"
import { HomeConfig } from "../src/Config.ts"
import { Journal } from "../src/Journal.ts"

const key = Redacted.make("masked")

/** Every service configured, with fake hosts. */
export const testConfig = {
  cloudUrl: "ws://cloud/home",
  port: 8788,
  dataDir: "/nonexistent",
  internalUrl: "http://quai-home:8788",
  radarr: { url: "http://radarr:7878", apiKey: key },
  sonarr: { url: "http://sonarr:8989", apiKey: key },
  qbittorrent: { url: "http://qbittorrent:8080", username: "admin", password: Redacted.make("pw") },
  jellyfin: { url: "http://jellyfin:8096", apiKey: key },
  reclaimerr: { url: "http://reclaimerr:8000", apiKey: key },
  seerr: { url: "http://seerr:5055", apiKey: key }
} satisfies HomeConfig["Service"]

export const configLayer = (overrides: Partial<HomeConfig["Service"]> = {}) =>
  Layer.succeed(HomeConfig, { ...testConfig, ...overrides })

/** A fresh temporary directory, removed when the test's scope closes. */
export const tempDir = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.makeTempDirectoryScoped({ prefix: "quai-home-" })
})

export { NodeFileSystem }

/** A real journal, in a temporary directory. */
export const journalLayer = Layer.effect(Journal, Effect.flatMap(tempDir, (dir) => Journal.make(join(dir, "journal")))).pipe(
  Layer.provide(NodeFileSystem.layer)
)
