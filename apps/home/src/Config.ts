import type { HomeProtocol } from "@quai/api"
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
 * Everything Quai Home needs, from `QUAI_*` environment variables. A service left unset (no URL,
 * or no key where it needs one) is not configured: Quai Home tells the cloud it can't reach it.
 */
export class HomeConfig extends Context.Service<HomeConfig, {
  /** The cloud's endpoint for homes, `ws://` or `wss://`. */
  readonly cloudUrl: string
  /** Port of the local webhook receiver and `/health`. */
  readonly port: number
  /** Where the home key and the home's documents live. */
  readonly dataDir: string
  /** How Radarr and Sonarr reach Quai Home, for the webhooks it sets up in them. */
  readonly internalUrl: string | null
  readonly radarr: ServiceEndpoint | null
  readonly sonarr: ServiceEndpoint | null
  readonly qbittorrent: QBittorrentEndpoint | null
  readonly jellyfin: ServiceEndpoint | null
  /** Reclaimerr's external API: a token from its Settings > Integrations, with `candidates:manage`. */
  readonly reclaimerr: ServiceEndpoint | null
  /** Seerr (Jellyseerr, Overseerr): its API key, from Settings > General. */
  readonly seerr: ServiceEndpoint | null
  /** Cleanuparr: its API key, from Settings > Account. */
  readonly cleanuparr: ServiceEndpoint | null
}>()("quai-home/HomeConfig") {
  static readonly layer = Layer.effect(
    HomeConfig,
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
        port: yield* Config.Port("QUAI_HOME_PORT").pipe(Config.withDefault(8788)),
        dataDir: yield* Config.String("QUAI_DATA_DIR").pipe(Config.withDefault("./data")),
        internalUrl: Option.match(internalUrl, { onNone: () => null, onSome: trimSlash }),
        radarr: yield* endpoint("RADARR"),
        sonarr: yield* endpoint("SONARR"),
        jellyfin: yield* endpoint("JELLYFIN"),
        reclaimerr: yield* endpoint("RECLAIMERR"),
        seerr: yield* endpoint("SEERR"),
        cleanuparr: yield* endpoint("CLEANUPARR"),
        qbittorrent: Option.isSome(qbUrl)
          ? { url: trimSlash(qbUrl.value), username: Option.getOrNull(qbUser), password: Option.getOrNull(qbPassword) }
          : null
      }
    })
  )
}

/** The services this home can reach, in the order the protocol lists them. */
export const configuredServices = (config: HomeConfig["Service"]): ReadonlyArray<HomeProtocol.HomeService> =>
  (["radarr", "sonarr", "qbittorrent", "jellyfin", "reclaimerr", "seerr", "cleanuparr"] as const).filter((service) => config[service] !== null)

const trimSlash = (url: string) => url.replace(/\/+$/, "")
