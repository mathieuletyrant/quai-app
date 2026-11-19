import { Layer, Redacted } from "effect"
import { AgentConfig } from "../src/Config.ts"

const key = Redacted.make("masked")

/** Every service configured, with fake hosts. */
export const testConfig = {
  cloudUrl: "ws://cloud/agent",
  token: Redacted.make("agent-token"),
  port: 8788,
  internalUrl: "http://quai-agent:8788",
  radarr: { url: "http://radarr:7878", apiKey: key },
  sonarr: { url: "http://sonarr:8989", apiKey: key },
  qbittorrent: { url: "http://qbittorrent:8080", username: "admin", password: Redacted.make("pw") },
  jellyfin: { url: "http://jellyfin:8096", apiKey: key }
} satisfies AgentConfig["Service"]

export const configLayer = (overrides: Partial<AgentConfig["Service"]> = {}) =>
  Layer.succeed(AgentConfig, { ...testConfig, ...overrides })
