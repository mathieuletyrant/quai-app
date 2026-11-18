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

/** Jellyfin's provider id keys are capitalized ("Tmdb", "Tvdb"), but be lenient. */
const providerId = (item: typeof Item.Type, provider: string) =>
  Object.entries(item.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === provider)?.[1]

export class Jellyfin extends Context.Service<Jellyfin, {
  /** Whether what the check names can be played in Jellyfin; with the item id when it can. */
  readonly find: (check: AvailabilityCheck) => Effect.Effect<string | null, StackError>
}>()("quai/Jellyfin") {
  static readonly layer = Layer.effect(
    Jellyfin,
    Effect.gen(function*() {
      const config = (yield* StackConfig).jellyfin
      const client = yield* HttpClient.HttpClient
      if (config === null) {
        return { find: () => Effect.fail(new StackError({ service: "jellyfin", message: "not configured" })) }
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
