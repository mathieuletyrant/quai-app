import type { AgentProtocol } from "@quai/api"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface ServiceEndpoint {
  readonly url: string
  readonly apiKey: Redacted.Redacted<string>
}

export interface QBittorrentEndpoint {
  readonly url: string
  readonly username: string | null
  readonly password: Redacted.Redacted<string> | null
}

/**
 * Everything the agent needs, from `QUAI_*` environment variables. A service left unset (no URL,
 * or no key where it needs one) is not configured: the agent tells the cloud it can't reach it.
 */
export class AgentConfig extends Context.Service<AgentConfig, {
  /** The cloud's agent endpoint, `ws://` or `wss://`. */
  readonly cloudUrl: string
  readonly token: Redacted.Redacted<string>
  /** Port of the local webhook receiver and `/health`. */
  readonly port: number
  /** How Radarr and Sonarr reach the agent, for the webhooks it sets up in them. */
  readonly internalUrl: string | null
  readonly radarr: ServiceEndpoint | null
  readonly sonarr: ServiceEndpoint | null
  readonly qbittorrent: QBittorrentEndpoint | null
  readonly jellyfin: ServiceEndpoint | null
}>()("quai-agent/AgentConfig") {
  static readonly layer = Layer.effect(
    AgentConfig,
    Effect.gen(function*() {
      const opt = (name: string) => Config.option(Config.String(name))
      const secret = (name: string) => Config.option(Config.Redacted(name))
      const endpoint = (prefix: string) =>
        Effect.gen(function*() {
          const url = yield* opt(`QUAI_${prefix}_URL`)
          const apiKey = yield* secret(`QUAI_${prefix}_API_KEY`)
          return Option.isSome(url) && Option.isSome(apiKey)
            ? { url: trimSlash(url.value), apiKey: apiKey.value }
            : null
        })
      const qbUrl = yield* opt("QUAI_QBITTORRENT_URL")
      const qbUser = yield* opt("QUAI_QBITTORRENT_USERNAME")
      const qbPassword = yield* secret("QUAI_QBITTORRENT_PASSWORD")
      const internalUrl = yield* opt("QUAI_INTERNAL_URL")
      return {
        cloudUrl: yield* Config.schema(Schema.String.check(Schema.isPattern(/^wss?:\/\//)), "QUAI_CLOUD_URL"),
        token: yield* Config.Redacted("QUAI_AGENT_TOKEN"),
        port: yield* Config.Port("QUAI_AGENT_PORT").pipe(Config.withDefault(8788)),
        internalUrl: Option.match(internalUrl, { onNone: () => null, onSome: trimSlash }),
        radarr: yield* endpoint("RADARR"),
        sonarr: yield* endpoint("SONARR"),
        jellyfin: yield* endpoint("JELLYFIN"),
        qbittorrent: Option.isSome(qbUrl)
          ? { url: trimSlash(qbUrl.value), username: Option.getOrNull(qbUser), password: Option.getOrNull(qbPassword) }
          : null
      }
    })
  )
}

/** The services this agent can reach, in the order the protocol lists them. */
export const configuredServices = (config: AgentConfig["Service"]): ReadonlyArray<AgentProtocol.AgentService> =>
  (["radarr", "sonarr", "qbittorrent", "jellyfin"] as const).filter((service) => config[service] !== null)

const trimSlash = (url: string) => url.replace(/\/+$/, "")
