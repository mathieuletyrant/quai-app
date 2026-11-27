import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { TitleKind } from "./Title.ts"

/**
 * A request made in Seerr that waits for an admin's approval. Requests Seerr approved on its own
 * (an auto-approve user) never wait, so they're never listed.
 */
export const MediaRequest = Schema.Struct({
  /** Seerr's request id. */
  id: Schema.Int,
  kind: TitleKind,
  title: Schema.String,
  year: Schema.optionalKey(Schema.Int),
  /** The poster's public URL (TMDB). */
  posterUrl: Schema.optionalKey(Schema.String),
  /** Who asked, as Seerr names them: "Julie". */
  requester: Schema.String,
  /** Epoch seconds. */
  requestedAt: Schema.optionalKey(Schema.Finite),
  /** A series: the seasons asked for; empty for a movie. */
  seasons: Schema.Array(Schema.Int),
  /** Asked in 4K. */
  is4k: Schema.Boolean
}).annotate({ identifier: "MediaRequest" })
export type MediaRequest = typeof MediaRequest.Type

/**
 * - `ok`: Seerr answered;
 * - `unavailable`: Quai Home reaches Seerr but it didn't answer this time;
 * - `notConfigured`: Quai Home has no Seerr (`QUAI_SEERR_URL`, `QUAI_SEERR_API_KEY`).
 */
export const RequestsStatus = Schema.Literals(["ok", "unavailable", "notConfigured"]).annotate({
  identifier: "RequestsStatus"
})

export const MediaRequests = Schema.Struct({
  /** Oldest first: the one waiting longest comes first. */
  items: Schema.Array(MediaRequest),
  status: RequestsStatus
}).annotate({ identifier: "MediaRequests" })
export type MediaRequests = typeof MediaRequests.Type

/** Seerr refused or failed the approval: its answer, in its words. */
export class RequestFailed extends Schema.TaggedError<RequestFailed>()("RequestFailed", {
  message: Schema.String
}, { httpApiStatus: 502 }) {}

/**
 * - `ok`: Seerr answered;
 * - `unavailable`: Quai Home reaches Seerr but it didn't answer this time;
 * - `notConfigured`: Quai Home has no Seerr;
 * - `outdated`: no longer sent (a Quai Home too old to search no longer links); kept for the apps that read it.
 */
export const SearchStatus = Schema.Literals(["ok", "unavailable", "notConfigured", "outdated"]).annotate({
  identifier: "SearchStatus"
})
export type SearchStatus = typeof SearchStatus.Type

/**
 * Where a title stands in Seerr:
 * - `requestable`: nobody asked for it;
 * - `requested`: asked for, waiting for approval or on its way;
 * - `partial`: a series with some seasons in the library: the others can still be requested;
 * - `available`: in the library.
 */
export const TitleState = Schema.Literals(["requestable", "requested", "partial", "available"]).annotate({
  identifier: "TitleState"
})
export type TitleState = typeof TitleState.Type

/** A movie or a series Seerr found. */
export const SearchResult = Schema.Struct({
  kind: TitleKind,
  /** TMDB's id: what a request names. */
  tmdbId: Schema.Int,
  /** A series' TVDB id, when Seerr knows it: Sonarr may not know the TMDB id. */
  tvdbId: Schema.optionalKey(Schema.Int),
  title: Schema.String,
  year: Schema.optionalKey(Schema.Int),
  /** The poster's public URL (TMDB). */
  posterUrl: Schema.optionalKey(Schema.String),
  overview: Schema.optionalKey(Schema.String),
  state: TitleState
}).annotate({ identifier: "SearchResult" })
export type SearchResult = typeof SearchResult.Type

/** Seerr's answer to a search, movies and series only (no people, no collections), in its order. */
export const SearchResults = Schema.Struct({
  items: Schema.Array(SearchResult),
  status: SearchStatus
}).annotate({ identifier: "SearchResults" })
export type SearchResults = typeof SearchResults.Type

/** A season of a series, as the season picker shows it. Specials (season 0) are left out. */
export const SeasonChoice = Schema.Struct({
  number: Schema.Int,
  episodes: Schema.optionalKey(Schema.Int),
  /** `requestable`, or already asked for or there. */
  state: TitleState
}).annotate({ identifier: "SeasonChoice" })
export type SeasonChoice = typeof SeasonChoice.Type

export const SeriesSeasons = Schema.Struct({
  seasons: Schema.Array(SeasonChoice)
}).annotate({ identifier: "SeriesSeasons" })
export type SeriesSeasons = typeof SeriesSeasons.Type

/**
 * A request made from the app. A series names its seasons (at least one); a movie none. The
 * requester is never in it: it's the Seerr user this iPhone chose (`DevicePreferences.seerrUserId`),
 * or Seerr's admin when it chose none.
 */
export const CreateRequest = Schema.Struct({
  kind: TitleKind,
  tmdbId: Schema.Int.check(Schema.isGreaterThan(0)),
  seasons: Schema.optionalKey(Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))))
}).annotate({ identifier: "CreateRequest" })
export type CreateRequest = typeof CreateRequest.Type

/** What Seerr made of the request: approved at once (an auto-approve user), or waiting for an admin. */
export const RequestCreated = Schema.Struct({
  status: Schema.Literals(["approved", "pending"])
}).annotate({ identifier: "RequestCreated" })
export type RequestCreated = typeof RequestCreated.Type

/** A Seerr user an iPhone can request as. */
export const SeerrUser = Schema.Struct({
  id: Schema.Int,
  /** As Seerr names them: "Julie". */
  name: Schema.String
}).annotate({ identifier: "SeerrUser" })
export type SeerrUser = typeof SeerrUser.Type

export const SeerrUsers = Schema.Struct({
  items: Schema.Array(SeerrUser),
  status: SearchStatus
}).annotate({ identifier: "SeerrUsers" })
export type SeerrUsers = typeof SeerrUsers.Type

const id = { id: Schema.String }

/**
 * Seerr for the app: the requests waiting for approval (the Requests tile and screen), and the
 * search that requests a title.
 */
export class RequestsGroup extends HttpApiGroup.make("requests")
  .add(
    HttpApiEndpoint.get("list", "/requests", { success: MediaRequests }).annotate(OpenApi.Identifier, "listRequests"),
    HttpApiEndpoint.post("approve", "/requests/:id/approve", {
      params: id,
      error: [RequestFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "approveRequest"),
    HttpApiEndpoint.post("decline", "/requests/:id/decline", {
      params: id,
      error: [RequestFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "declineRequest"),
    HttpApiEndpoint.post("create", "/requests", {
      payload: CreateRequest,
      success: RequestCreated,
      error: [RequestFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "createRequest"),
    HttpApiEndpoint.get("users", "/requests/users", { success: SeerrUsers }).annotate(
      OpenApi.Identifier,
      "listSeerrUsers"
    ),
    HttpApiEndpoint.get("search", "/search", { query: { query: Schema.String }, success: SearchResults })
      .annotate(OpenApi.Identifier, "searchTitles"),
    HttpApiEndpoint.get("seasons", "/search/series/:tmdbId", {
      params: { tmdbId: Schema.String },
      success: SeriesSeasons,
      error: [RequestFailed, HttpApiError.NotFound]
    })
      .annotate(OpenApi.Identifier, "listSeasons")
  )
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api")
{}
