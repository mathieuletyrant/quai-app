import { type HomeOffline, type SearchResults } from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { HomeReads } from "../home/HomeReads.ts"
import { movieLookupPath, movieResult, RadarrLookup } from "../integrations/radarr.ts"
import { seriesLookupPath, seriesResult, SonarrLookup } from "../integrations/sonarr.ts"

/** Results per service: Radarr and Sonarr answer the best matches first, and a phone shows a screen. */
export const resultsPerService = 10

/**
 * Searching movies and series to add, read through Quai Home when the app asks (nothing is kept):
 * Radarr's and Sonarr's lookups at once. A service that doesn't answer is listed as unavailable,
 * the other one still shows. A title can be requested when Quai Home reaches Seerr.
 */
export class Search extends Context.Service<Search, {
  readonly search: (term: string) => Effect.Effect<SearchResults, HomeOffline>
}>()("quai/Search") {
  static readonly layer = Layer.effect(
    Search,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      return {
        search: (term) =>
          Effect.gen(function*() {
            const trimmed = term.trim()
            const services = yield* reads.services
            const canRequest = services.includes("seerr")
            if (trimmed === "") return { items: [], unavailable: [], canRequest }
            const { values, unavailable } = yield* reads.all({
              movies: { service: "radarr", path: movieLookupPath(trimmed), schema: RadarrLookup },
              series: { service: "sonarr", path: seriesLookupPath(trimmed), schema: SonarrLookup }
            })
            const items = [
              ...Option.getOrElse(values.movies, () => []).slice(0, resultsPerService).map(movieResult),
              ...Option.getOrElse(values.series, () => []).slice(0, resultsPerService).map(seriesResult)
            ]
            return { items, unavailable, canRequest }
          })
      }
    })
  )
}
