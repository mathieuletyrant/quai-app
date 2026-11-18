import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

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
 * Where the stack lives. For now from `QUAI_*` environment variables; the console's guided setup
 * will store them (milestone 4). A service left unset is simply not watched.
 */
export class StackConfig extends Context.Service<StackConfig, {
  readonly radarr: ServiceEndpoint | null
  readonly sonarr: ServiceEndpoint | null
  readonly qbittorrent: QBittorrentEndpoint | null
  readonly jellyfin: ServiceEndpoint | null
  /** How the *arr apps reach Quai, for the webhooks Quai sets up in them. */
  readonly internalUrl: string | null
}>()("quai/StackConfig") {
  static readonly layer = Layer.effect(
    StackConfig,
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
        radarr: yield* endpoint("RADARR"),
        sonarr: yield* endpoint("SONARR"),
        jellyfin: yield* endpoint("JELLYFIN"),
        qbittorrent: Option.isSome(qbUrl)
          ? {
            url: trimSlash(qbUrl.value),
            username: Option.getOrNull(qbUser),
            password: Option.getOrNull(qbPassword)
          }
          : null,
        internalUrl: Option.match(internalUrl, { onNone: () => null, onSome: trimSlash })
      }
    })
  )
}

const trimSlash = (url: string) => url.replace(/\/+$/, "")
