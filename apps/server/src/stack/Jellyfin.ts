import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { AvailabilityCheck } from "./Availability.ts"
import { StackError } from "./Errors.ts"
import { StackConfig } from "./StackConfig.ts"

const Item = Schema.Struct({
  Id: Schema.String,
  ProviderIds: Schema.optional(Schema.Record(Schema.String, Schema.String))
})
export const ItemsResult = Schema.Struct({ Items: Schema.Array(Item) })

const Episode = Schema.Struct({
  ParentIndexNumber: Schema.optional(Schema.Number),
  IndexNumber: Schema.optional(Schema.Number),
  LocationType: Schema.optional(Schema.String)
})
export const EpisodesResult = Schema.Struct({ Items: Schema.Array(Episode) })

const Session = Schema.Struct({
  Id: Schema.String,
  DeviceName: Schema.optional(Schema.String),
  NowPlayingItem: Schema.optional(Schema.Struct({
    Id: Schema.String,
    Name: Schema.String,
    SeriesName: Schema.optional(Schema.String),
    ParentIndexNumber: Schema.optional(Schema.Number),
    IndexNumber: Schema.optional(Schema.Number),
    RunTimeTicks: Schema.optional(Schema.Number)
  })),
  PlayState: Schema.optional(Schema.Struct({
    PositionTicks: Schema.optional(Schema.Number),
    IsPaused: Schema.optional(Schema.Boolean)
  }))
})
export const Sessions = Schema.Array(Session)

/** Something playing on a Jellyfin device, as Quai follows it. */
export interface Playing {
  readonly key: string
  readonly title: string
  readonly device: string
  readonly paused: boolean
  /** Milliseconds left, when Jellyfin knows the runtime. */
  readonly remainingMs: number | null
}

const pad = (n: number) => n.toString().padStart(2, "0")

export const playingFrom = (sessions: typeof Sessions.Type): ReadonlyArray<Playing> =>
  sessions.flatMap((s) => {
    const item = s.NowPlayingItem
    if (item === undefined) return []
    const episode = item.SeriesName !== undefined && item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
      ? `${item.SeriesName} · S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}`
      : null
    const runtime = item.RunTimeTicks
    const position = s.PlayState?.PositionTicks ?? 0
    return [{
      key: `playback:${s.Id}:${item.Id}`,
      title: episode ?? item.Name,
      device: s.DeviceName ?? "Jellyfin",
      paused: s.PlayState?.IsPaused === true,
      // Jellyfin ticks are 100 ns.
      remainingMs: runtime === undefined ? null : Math.max(0, (runtime - position) / 10_000)
    }]
  })

/** Jellyfin's provider id keys are capitalized ("Tmdb", "Tvdb"), but be lenient. */
const providerId = (item: typeof Item.Type, provider: string) =>
  Object.entries(item.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === provider)?.[1]

export class Jellyfin extends Context.Service<Jellyfin, {
  /** Whether what the check names can be played in Jellyfin; with the item id when it can. */
  readonly find: (check: AvailabilityCheck) => Effect.Effect<string | null, StackError>
  /** What plays right now, on every device. */
  readonly playing: Effect.Effect<ReadonlyArray<Playing>, StackError>
}>()("quai/Jellyfin") {
  static readonly layer = Layer.effect(
    Jellyfin,
    Effect.gen(function*() {
      const config = (yield* StackConfig).jellyfin
      const client = yield* HttpClient.HttpClient
      if (config === null) {
        const missing = new StackError({ service: "jellyfin", message: "not configured" })
        return { find: () => Effect.fail(missing), playing: Effect.fail(missing) }
      }
      const get = <A, I>(path: string, params: Record<string, string>, schema: Schema.Codec<A, I>) =>
        client.execute(
          HttpClientRequest.get(`${config.url}${path}`).pipe(
            HttpClientRequest.setUrlParams(params),
            HttpClientRequest.setHeader("Authorization", `MediaBrowser Token="${Redacted.value(config.apiKey)}"`)
          )
        ).pipe(
          Effect.flatMap((r) => r.status === 200 ? r.json : Effect.fail(new Error(`HTTP ${r.status}`))),
          Effect.flatMap(Schema.decodeUnknownEffect(schema)),
          Effect.mapError((cause) => new StackError({ service: "jellyfin", message: `could not read ${path}`, cause }))
        )

      const search = (type: "Movie" | "Series", title: string) =>
        get("/Items", { Recursive: "true", IncludeItemTypes: type, SearchTerm: title, Fields: "ProviderIds" }, ItemsResult)

      return {
        playing: Effect.map(get("/Sessions", { ActiveWithinSeconds: "120" }, Sessions), playingFrom),
        find: (check: AvailabilityCheck) =>
          Effect.gen(function*() {
            if (check._tag === "Movie") {
              const { Items } = yield* search("Movie", check.title)
              return Items.find((i) => providerId(i, "tmdb") === String(check.tmdbId))?.Id ?? null
            }
            const { Items } = yield* search("Series", check.title)
            const series = Items.find((i) => providerId(i, "tvdb") === String(check.tvdbId))
            if (series === undefined) return null
            const episodes = yield* get(`/Shows/${series.Id}/Episodes`, {}, EpisodesResult)
            const present = new Set(
              episodes.Items.filter((e) => e.LocationType !== "Virtual").map((e) =>
                `${e.ParentIndexNumber}:${e.IndexNumber}`
              )
            )
            return check.episodes.every((e: { readonly season: number; readonly episode: number }) => present.has(`${e.season}:${e.episode}`)) ? series.Id : null
          })
      }
    })
  )
}
