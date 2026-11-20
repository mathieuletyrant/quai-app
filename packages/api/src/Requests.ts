import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/http-api"
import { DeviceAuth, HomeRequired } from "./Devices.ts"

export const RequestKind = Schema.Literals(["movie", "series"]).annotate({ identifier: "RequestKind" })
export type RequestKind = typeof RequestKind.Type

/**
 * A request made in Seerr that waits for an admin's approval. Requests Seerr approved on its own
 * (an auto-approve user) never wait, so they're never listed.
 */
export const MediaRequest = Schema.Struct({
  /** Seerr's request id. */
  id: Schema.Int,
  kind: RequestKind,
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
export const RequestsStatus = Schema.Literals(["ok", "unavailable", "notConfigured"]).annotate({ identifier: "RequestsStatus" })

export const MediaRequests = Schema.Struct({
  /** Oldest first: the one waiting longest comes first. */
  items: Schema.Array(MediaRequest),
  status: RequestsStatus
}).annotate({ identifier: "MediaRequests" })
export type MediaRequests = typeof MediaRequests.Type

/** Seerr refused or failed the request or the approval: its answer, in its words. */
export class RequestFailed extends Schema.TaggedError<RequestFailed>()("RequestFailed", {
  message: Schema.String
}, { httpApiStatus: 502 }) {}

/** A title to request in Seerr, by its TMDB id: a series asks for its first season. */
export const NewRequest = Schema.Struct({
  kind: RequestKind,
  tmdbId: Schema.Int.check(Schema.isGreaterThan(0))
}).annotate({ identifier: "NewRequest" })
export type NewRequest = typeof NewRequest.Type

/** Quai Home has no Seerr: nothing can be requested. */
export class RequestsNotConfigured extends Schema.TaggedError<RequestsNotConfigured>()("RequestsNotConfigured", {
  message: Schema.String
}, { httpApiStatus: 409 }) {}

const id = { id: Schema.String }

/** Seerr's requests: those waiting for approval (the app's Requests tile and screen), and asking for a title. */
export class RequestsGroup extends HttpApiGroup.make("requests")
  .add(
    HttpApiEndpoint.get("list", "/requests", { success: MediaRequests }).annotate(OpenApi.Identifier, "listRequests"),
    HttpApiEndpoint.post("create", "/requests", { payload: NewRequest, error: [RequestFailed, RequestsNotConfigured] })
      .annotate(OpenApi.Identifier, "createRequest"),
    HttpApiEndpoint.post("approve", "/requests/:id/approve", { params: id, error: [RequestFailed, HttpApiError.NotFound] })
      .annotate(OpenApi.Identifier, "approveRequest"),
    HttpApiEndpoint.post("decline", "/requests/:id/decline", { params: id, error: [RequestFailed, HttpApiError.NotFound] })
      .annotate(OpenApi.Identifier, "declineRequest")
  )
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api") {}

