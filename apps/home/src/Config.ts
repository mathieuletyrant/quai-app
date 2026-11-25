import { HomeProtocol } from "@quai/api"
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
 * Everything Quai Home reads from `QUAI_*` environment variables. A service set here (URL, and key
 * where it needs one) wins over the console's Services page (`ServiceSettings`); one left unset can
 * be set there.
 */
export class HomeConfig extends Context.Service<HomeConfig, {
  /** The cloud's endpoint for homes, `ws://` or `wss://`. Unset, Quai Home runs without a Cloud. */
  readonly cloudUrl: string | null
  /**
   * Where the iPhone app reaches the Cloud at home, for the pairing QR code, when `cloudUrl` is an
   * address only Quai Home reaches (a container name). Unset, `cloudUrl` in http(s).
   */
  readonly cloudAppUrl: string | null
  /** Where the console is reached from outside the home (`QUAI_CONSOLE_PUBLIC_URL`), for the app's "Open the console". */
  readonly consolePublicUrl: string | null
  /** The console's password. Unset, the console stays locked and says to set it. */
  readonly password: Redacted.Redacted<string> | null
  /** The built console Quai Home serves (set in the image). */
  readonly consoleDir: string | null
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
  /** Prowlarr: read for the alerts only (is it up, what its System > Status reports). */
  readonly prowlarr: ServiceEndpoint | null
  /** Where an iPhone opens Radarr and Sonarr: at home, then from outside. Sent in Hello. */
  readonly webUrls: HomeProtocol.WebUrls
  /**
   * A service's address set without its key (`QUAI_RADARR_URL` alone): not configured, but what the
   * console's Services page fills in, so only the key is pasted.
   */
  readonly suggestedUrls: Partial<Record<HomeProtocol.HomeService, string>>
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
      const keyed = ["radarr", "sonarr", "jellyfin", "reclaimerr", "seerr", "cleanuparr", "prowlarr"] as const
      const suggestedUrls: Partial<Record<HomeProtocol.HomeService, string>> = {}
      for (const service of keyed) {
        const prefix = service.toUpperCase()
        const url = yield* opt(`QUAI_${prefix}_URL`)
        const apiKey = yield* opt(`QUAI_${prefix}_API_KEY`)
        if (Option.isSome(url) && url.value.trim() !== "" && Option.isNone(apiKey)) suggestedUrls[service] = trimSlash(url.value.trim())
      }
      const qbUrl = yield* opt("QUAI_QBITTORRENT_URL")
      const qbUser = yield* opt("QUAI_QBITTORRENT_USERNAME")
      const qbPassword = yield* secret("QUAI_QBITTORRENT_PASSWORD")
      const internalUrl = yield* opt("QUAI_INTERNAL_URL")
      const webUrlsOf = (prefix: string) =>
        Effect.map(
          Effect.all([opt(`QUAI_${prefix}_WEB_URL`), opt(`QUAI_${prefix}_PUBLIC_URL`)]),
          (urls) => urls.flatMap((url) => Option.isSome(url) && url.value.trim() !== "" ? [trimSlash(url.value.trim())] : [])
        )
      const radarrWebUrls = yield* webUrlsOf("RADARR")
      const sonarrWebUrls = yield* webUrlsOf("SONARR")
      const nonEmpty = (value: Option.Option<string>) => Option.filter(Option.map(value, (text) => text.trim()), (text) => text !== "")
      const password = yield* secret("QUAI_HOME_PASSWORD")
      return {
        cloudUrl: Option.getOrNull(nonEmpty(yield* Config.option(Config.schema(Schema.String.check(Schema.isPattern(/^\s*(wss?:\/\/.*)?$/)), "QUAI_CLOUD_URL")))),
        cloudAppUrl: Option.getOrNull(Option.map(nonEmpty(yield* opt("QUAI_CLOUD_APP_URL")), trimSlash)),
        consolePublicUrl: Option.getOrNull(Option.map(nonEmpty(yield* opt("QUAI_CONSOLE_PUBLIC_URL")), trimSlash)),
        password: Option.getOrNull(Option.filter(password, (redacted) => Redacted.value(redacted) !== "")),
        consoleDir: Option.getOrNull(nonEmpty(yield* opt("QUAI_CONSOLE_DIR"))),
        port: yield* Config.Port("QUAI_HOME_PORT").pipe(Config.withDefault(8788)),
        dataDir: yield* Config.String("QUAI_DATA_DIR").pipe(Config.withDefault("./data")),
        internalUrl: Option.match(internalUrl, { onNone: () => null, onSome: trimSlash }),
        radarr: yield* endpoint("RADARR"),
        sonarr: yield* endpoint("SONARR"),
        jellyfin: yield* endpoint("JELLYFIN"),
        reclaimerr: yield* endpoint("RECLAIMERR"),
        seerr: yield* endpoint("SEERR"),
        cleanuparr: yield* endpoint("CLEANUPARR"),
        prowlarr: yield* endpoint("PROWLARR"),
        qbittorrent: Option.isSome(qbUrl)
          ? { url: trimSlash(qbUrl.value), username: Option.getOrNull(qbUser), password: Option.getOrNull(qbPassword) }
          : null,
        suggestedUrls,
        webUrls: {
          ...(radarrWebUrls.length === 0 ? {} : { radarr: radarrWebUrls }),
          ...(sonarrWebUrls.length === 0 ? {} : { sonarr: sonarrWebUrls })
        }
      }
    })
  )
}

/** Every service, in the order the protocol lists them. */
export const allServices = HomeProtocol.HomeService.literals

/** The services set by the environment or the Services page, as `ServiceSettings` holds them. */
export type Endpoints = Pick<HomeConfig["Service"], HomeProtocol.HomeService>

/** The services this home can reach, in the order the protocol lists them. */
export const configuredServices = (endpoints: Endpoints): ReadonlyArray<HomeProtocol.HomeService> =>
  allServices.filter((service) => endpoints[service] !== null)

/** The Cloud's own address from its link address: `QUAI_CLOUD_URL` in http(s), without `/home`. */
export const cloudHttpUrl = (cloudUrl: string) =>
  cloudUrl.trim().replace(/^ws/, "http").replace(/\/home\/?$/, "").replace(/\/+$/, "")

const trimSlash = (url: string) => url.replace(/\/+$/, "")

/** Where the iPhone app reaches the Cloud at home: `QUAI_CLOUD_APP_URL`, else the link's address in http(s). */
export const cloudAppUrl = (config: Pick<HomeConfig["Service"], "cloudUrl" | "cloudAppUrl">): string | null =>
  config.cloudAppUrl ?? (config.cloudUrl === null ? null : cloudHttpUrl(config.cloudUrl))
