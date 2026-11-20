import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { LibraryService } from "./Library.ts"
import { RequestKind } from "./Requests.ts"

/**
 * Where a title found by a search stands in the home:
 * - `available`: Radarr or Sonarr has it on disk (a series: at least one episode);
 * - `wanted`: in Radarr or Sonarr, without a file yet;
 * - `notAdded`: neither has it.
 */
export const SearchState = Schema.Literals(["available", "wanted", "notAdded"]).annotate({ identifier: "SearchState" })
export type SearchState = typeof SearchState.Type

/** A movie or a series a search found, as Radarr or Sonarr looked it up (TMDB, TheTVDB). */
export const SearchResult = Schema.Struct({
  /** `movie:tmdb:<id>` or `series:tvdb:<id>`: unique in the list. */
  id: Schema.String,
  kind: RequestKind,
  title: Schema.String,
  year: Schema.optionalKey(Schema.Int),
  /** The poster's public URL. Never a URL that needs a key. */
  posterUrl: Schema.optionalKey(Schema.String),
  overview: Schema.optionalKey(Schema.String),
  state: SearchState,
  /** The TMDB id a request needs; absent for a series Sonarr knows only by TheTVDB. */
  tmdbId: Schema.optionalKey(Schema.Int)
}).annotate({ identifier: "SearchResult" })
export type SearchResult = typeof SearchResult.Type

export const SearchResults = Schema.Struct({
  /** Radarr's then Sonarr's, each in its own order (best match first). */
  items: Schema.Array(SearchResult),
  /** Services Quai Home reaches that couldn't search this time: their titles are missing. */
  unavailable: Schema.Array(LibraryService),
  /** Seerr is set up: a title not added yet can be requested (`createRequest`). */
  canRequest: Schema.Boolean
}).annotate({ identifier: "SearchResults" })
export type SearchResults = typeof SearchResults.Type

/** Searching movies and series to add, for the app's Library tab. */
export class SearchGroup extends HttpApiGroup.make("search")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: { q: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)) },
      success: SearchResults
    }).annotate(OpenApi.Identifier, "search")
  )
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api") {}
