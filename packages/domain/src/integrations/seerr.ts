import {
  type ActionType,
  type CreateRequest,
  type HomeOffline,
  InvalidAction,
  type MediaRequest,
  RequestFailed,
  type SearchResult,
  type SeasonChoice,
  type SeerrUser,
  TitleKind,
  type TitleState
} from "@quai/api"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import { type FlowEvent, requestKey, type Subject } from "../flows/Events.ts"
import { HomeReads, type Read } from "../home/HomeReads.ts"
import { epochSeconds, knownYear } from "./arr.ts"
import {
  type ActionHandler,
  anyEnabledFlow,
  type Integration,
  readJson,
  readSnapshot,
  runningWhere,
  type WatchContext,
  watchOf
} from "./Integration.ts"

/**
 * Seerr (Jellyseerr, Overseerr): the requests of the household. Quai follows only those that wait
 * for an admin (status pending): a request Seerr approved on its own (an auto-approve user) never
 * waits, so it starts nothing and is never listed.
 *
 * Quai Home sets Seerr's webhook up when its one webhook agent is free (or already Quai's), so a
 * request comes at once. Quai also polls the pending requests every minute while a request
 * flow is on: the only way in when the webhook is someone else's, and the safety net for a
 * notification missed while Quai Home was down.
 */

/** Seerr's request statuses (server/constants/media.ts, MediaRequestStatus). */
export const RequestStatus = { pending: 1, approved: 2, declined: 3, failed: 4, completed: 5 } as const

/**
 * The requests waiting for approval, oldest first, so a long wait is never cut off the page. 50 is
 * plenty for a household.
 */
export const pendingPath = "/api/v1/request?take=50&skip=0&filter=pending&sort=added&sortDirection=asc"
export const requestPath = (id: number) => `/api/v1/request/${id}`
export const decisionPath = (id: number, decision: "approve" | "decline") => `/api/v1/request/${id}/${decision}`
export const detailsPath = (kind: "movie" | "tv", tmdbId: number) => `/api/v1/${kind}/${tmdbId}`

/** TMDB's public poster URL, at the width the app shows. */
export const posterUrl = (posterPath: string | null | undefined) =>
  posterPath !== undefined && posterPath !== null && /^\/[\w.-]+$/.test(posterPath)
    ? `https://image.tmdb.org/t/p/w342${posterPath}`
    : undefined

const User = Schema.Struct({
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  username: Schema.optional(Schema.NullOr(Schema.String)),
  jellyfinUsername: Schema.optional(Schema.NullOr(Schema.String)),
  plexUsername: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String))
})

/** One `MediaRequest` of Seerr's API, only the fields Quai reads. */
export const SeerrRequest = Schema.Struct({
  id: Schema.Number,
  status: Schema.Number,
  type: Schema.optional(Schema.String),
  is4k: Schema.optional(Schema.Boolean),
  createdAt: Schema.optional(Schema.String),
  media: Schema.Struct({
    mediaType: Schema.optional(Schema.String),
    tmdbId: Schema.Number
  }),
  seasons: Schema.optional(Schema.Array(Schema.Struct({ seasonNumber: Schema.Number }))),
  requestedBy: Schema.optional(Schema.NullOr(User))
})
export type SeerrRequest = typeof SeerrRequest.Type

export const SeerrRequestPage = Schema.Struct({ results: Schema.Array(SeerrRequest) })

/** The requests waiting for approval: read when the app asks, and watched while a request flow is on. */
export const pendingRead: Read<typeof SeerrRequestPage.Type> = {
  service: "seerr",
  path: pendingPath,
  schema: SeerrRequestPage
}

/** `GET /api/v1/movie/{id}` and `GET /api/v1/tv/{id}`: a movie has a title, a series a name. */
export const SeerrTitle = Schema.Struct({
  title: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  firstAirDate: Schema.optional(Schema.NullOr(Schema.String)),
  posterPath: Schema.optional(Schema.NullOr(Schema.String))
})

/** What a request asks for, as the app shows it. */
export interface TitleDetails {
  readonly title: string
  readonly year?: number | undefined
  readonly posterUrl?: string | undefined
}

export const kindOf = (request: SeerrRequest): TitleKind =>
  (request.type ?? request.media.mediaType) === "tv" ? "series" : "movie"

/** How Seerr names a user: its display name, else a username or the email. */
const userName = (user: typeof User.Type | null | undefined) =>
  [user?.displayName, user?.username, user?.jellyfinUsername, user?.plexUsername, user?.email]
    .find((name): name is string => typeof name === "string" && name !== "")

export const requesterOf = (request: SeerrRequest) => userName(request.requestedBy) ?? "Someone"

export const titleDetails = (body: typeof SeerrTitle.Type): TitleDetails | undefined => {
  const title = body.title ?? body.name
  if (title === undefined || title === "") return undefined
  const date = body.releaseDate ?? body.firstAirDate
  const year = knownYear(date === undefined || date === null ? undefined : Number(date.slice(0, 4)))
  return { title, year, posterUrl: posterUrl(body.posterPath) }
}

/** "Julie · Movie · 2024", "Julie · Series · S1–2 · 4K". */
export const requestDetail = (requester: string, kind: TitleKind, options: {
  readonly year?: number | undefined
  readonly seasons?: ReadonlyArray<number>
  readonly is4k?: boolean | undefined
} = {}) => {
  const seasons = [...(options.seasons ?? [])].sort((left, right) => left - right)
  const range = seasons.length === 0
    ? undefined
    : seasons.length === 1
    ? `S${seasons[0]}`
    : seasons.every((season, index) => index === 0 || season === seasons[index - 1]! + 1)
    ? `S${seasons[0]}–${seasons[seasons.length - 1]}`
    : `${seasons.length} seasons`
  return [
    requester,
    kind === "movie" ? "Movie" : "Series",
    options.year,
    range,
    options.is4k === true ? "4K" : undefined
  ]
    .filter((part) => part !== undefined).join(" · ")
}

export const toMediaRequest = (request: SeerrRequest, details: TitleDetails | undefined): MediaRequest => {
  const kind = kindOf(request)
  const requestedAt = epochSeconds(request.createdAt)
  return {
    id: request.id,
    kind,
    title: details?.title ?? `TMDB ${request.media.tmdbId}`,
    ...(details?.year === undefined ? {} : { year: details.year }),
    ...(details?.posterUrl === undefined ? {} : { posterUrl: details.posterUrl }),
    requester: requesterOf(request),
    ...(requestedAt === undefined ? {} : { requestedAt }),
    seasons: kind === "series"
      ? (request.seasons ?? []).map((season) => season.seasonNumber).sort((left, right) => left - right)
      : [],
    is4k: request.is4k === true
  }
}

/** Only what really waits: a request Seerr approved on its own is never pending. */
export const waiting = (requests: ReadonlyArray<SeerrRequest>) =>
  requests.filter((request) => request.status === RequestStatus.pending)

const subjectOf = (
  request: { readonly id: number; readonly title: string; readonly kind: TitleKind; readonly requester: string }
): Subject => ({
  kind: "request",
  key: requestKey(request.id),
  title: request.title,
  mediaType: request.kind,
  requester: request.requester
})

export const pendingEvent = (request: MediaRequest): FlowEvent => ({
  type: "request.pending",
  subject: subjectOf(request),
  values: { detail: requestDetail(request.requester, request.kind, request) }
})

// The webhook: what Quai Home's template (apps/home/src/SeerrWebhook.ts) makes Seerr post.

export const SeerrWebhook = Schema.Struct({
  notification_type: Schema.String,
  /** The title and its year: "Paddington in Peru (2024)". */
  subject: Schema.optional(Schema.String),
  media: Schema.optional(Schema.NullOr(Schema.Struct({
    media_type: Schema.optional(Schema.String),
    tmdbId: Schema.optional(Schema.String)
  }))),
  request: Schema.optional(Schema.NullOr(Schema.Struct({
    request_id: Schema.optional(Schema.String),
    requestedBy_username: Schema.optional(Schema.String)
  })))
})
export type SeerrWebhook = typeof SeerrWebhook.Type

/** "Paddington in Peru (2024)" → the title and its year. */
export const splitSubject = (subject: string): { readonly title: string; readonly year?: number | undefined } => {
  const match = /^(.*\S)\s+\((\d{4})\)$/.exec(subject.trim())
  return match === null ? { title: subject.trim() } : { title: match[1]!, year: knownYear(Number(match[2])) }
}

/**
 * Seerr's notifications in the catalog's terms. Only `MEDIA_PENDING` starts something; approved
 * and declined move or end it. `MEDIA_AUTO_APPROVED`, a test, an issue: nothing.
 */
export const seerrEvents = (payload: SeerrWebhook): ReadonlyArray<FlowEvent> => {
  const type = payload.notification_type
  if (type !== "MEDIA_PENDING" && type !== "MEDIA_APPROVED" && type !== "MEDIA_DECLINED") return []
  const id = Number(payload.request?.request_id ?? "")
  if (!Number.isInteger(id) || id <= 0 || payload.subject === undefined || payload.subject === "") return []
  const { title, year } = splitSubject(payload.subject)
  const kind = payload.media?.media_type === "tv" ? "series" as const : "movie" as const
  const requester = payload.request?.requestedBy_username || "Someone"
  const subject = subjectOf({ id, title, kind, requester })
  switch (type) {
    case "MEDIA_PENDING":
      return [{ type: "request.pending", subject, values: { detail: requestDetail(requester, kind, { year }) } }]
    case "MEDIA_APPROVED":
      return [{ type: "request.approved", subject, values: { detail: requester } }]
    case "MEDIA_DECLINED":
      return [{ type: "request.declined", subject, values: { detail: "Declined" } }]
  }
}

export const decodeSeerrWebhook = Schema.decodeUnknownEffect(SeerrWebhook)

/** The id of a request subject (`request:12`). */
export const requestIdOf = (subjectKey: string): number | null => {
  const [kind, id] = subjectKey.split(":")
  const parsed = Number(id)
  return kind === "request" && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// Searching and requesting, from the app's search.

/** Seerr's media statuses (server/constants/media.ts, MediaStatus): a title's or a season's. */
export const MediaStatus = {
  unknown: 1,
  pending: 2,
  processing: 3,
  partiallyAvailable: 4,
  available: 5,
  blocklisted: 6,
  deleted: 7
} as const

/** Where a title or a season stands, in the app's words. Blocklisted or deleted: as if nobody asked. */
export const titleState = (status: number | undefined): TitleState => {
  switch (status) {
    case MediaStatus.pending:
    case MediaStatus.processing:
      return "requested"
    case MediaStatus.partiallyAvailable:
      return "partial"
    case MediaStatus.available:
      return "available"
    default:
      return "requestable"
  }
}

/**
 * Seerr wants a strictly encoded query: `encodeURIComponent` leaves `!'()*` as they are, and Seerr
 * answers 400 to "Ocean's Eleven" unless they're encoded too.
 */
export const searchPath = (query: string) =>
  `/api/v1/search?query=${
    encodeURIComponent(query).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  }&page=1`

/** Seerr's users, enough for a household. */
export const usersPath = "/api/v1/user?take=100&skip=0&sort=displayname"

export const createPath = "/api/v1/request"

/** One result of `GET /api/v1/search`: a movie, a series, a person or a collection. */
export const SeerrSearchResult = Schema.Struct({
  id: Schema.Number,
  mediaType: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  firstAirDate: Schema.optional(Schema.NullOr(Schema.String)),
  posterPath: Schema.optional(Schema.NullOr(Schema.String)),
  overview: Schema.optional(Schema.NullOr(Schema.String)),
  mediaInfo: Schema.optional(Schema.NullOr(Schema.Struct({
    status: Schema.optional(Schema.Number),
    tvdbId: Schema.optional(Schema.NullOr(Schema.Number))
  })))
})

export const SeerrSearchPage = Schema.Struct({ results: Schema.Array(SeerrSearchResult) })

/** Movies and series only, in Seerr's order (the most relevant first). */
export const searchResults = (page: typeof SeerrSearchPage.Type): ReadonlyArray<SearchResult> =>
  page.results.flatMap((result): ReadonlyArray<SearchResult> => {
    if (result.mediaType !== "movie" && result.mediaType !== "tv") return []
    const title = (result.mediaType === "movie" ? result.title : result.name) ?? result.title ?? result.name
    if (title === undefined || title === null || title === "") return []
    const date = result.mediaType === "movie" ? result.releaseDate : result.firstAirDate
    const year = knownYear(date === undefined || date === null || date === "" ? undefined : Number(date.slice(0, 4)))
    const poster = posterUrl(result.posterPath)
    const overview = result.overview?.trim()
    const tvdbId = result.mediaType === "tv" ? result.mediaInfo?.tvdbId : undefined
    return [{
      kind: result.mediaType === "movie" ? "movie" : "series",
      tmdbId: result.id,
      ...(tvdbId === undefined || tvdbId === null || tvdbId === 0 ? {} : { tvdbId }),
      title,
      ...(year === undefined ? {} : { year }),
      ...(poster === undefined ? {} : { posterUrl: poster }),
      ...(overview === undefined || overview === "" ? {} : { overview }),
      state: titleState(result.mediaInfo?.status)
    }]
  })

/** `GET /api/v1/tv/{id}`: its seasons, and those Seerr already knows of (there, or asked for). */
export const SeerrSeries = Schema.Struct({
  seasons: Schema.optional(Schema.Array(Schema.Struct({
    seasonNumber: Schema.Number,
    episodeCount: Schema.optional(Schema.NullOr(Schema.Number))
  }))),
  mediaInfo: Schema.optional(Schema.NullOr(Schema.Struct({
    seasons: Schema.optional(Schema.Array(Schema.Struct({ seasonNumber: Schema.Number, status: Schema.Number }))),
    requests: Schema.optional(Schema.Array(Schema.Struct({
      status: Schema.Number,
      seasons: Schema.optional(Schema.Array(Schema.Struct({ seasonNumber: Schema.Number })))
    })))
  })))
})

/**
 * Each season but the specials, and where it stands: the library's state first, else asked for
 * when a request waiting or approved names it.
 */
export const seasonChoices = (series: typeof SeerrSeries.Type): ReadonlyArray<SeasonChoice> => {
  const known = new Map(
    (series.mediaInfo?.seasons ?? []).map((season) => [season.seasonNumber, titleState(season.status)])
  )
  const asked = new Set(
    (series.mediaInfo?.requests ?? [])
      .filter((request) => request.status === RequestStatus.pending || request.status === RequestStatus.approved)
      .flatMap((request) => (request.seasons ?? []).map((season) => season.seasonNumber))
  )
  return (series.seasons ?? [])
    .filter((season) => season.seasonNumber > 0)
    .sort((left, right) => left.seasonNumber - right.seasonNumber)
    .map((season) => {
      const state = known.get(season.seasonNumber) ?? "requestable"
      const episodes = season.episodeCount ?? undefined
      return {
        number: season.seasonNumber,
        ...(episodes === undefined ? {} : { episodes }),
        state: state === "requestable" && asked.has(season.seasonNumber) ? "requested" : state
      }
    })
}

/** `GET /api/v1/user`: Seerr names a user by `displayName`, which it fills in itself. */
export const SeerrUserPage = Schema.Struct({
  results: Schema.Array(Schema.Struct({ id: Schema.Number, ...User.fields }))
})

export const seerrUsers = (page: typeof SeerrUserPage.Type): ReadonlyArray<SeerrUser> =>
  page.results.map((user) => ({ id: user.id, name: userName(user) ?? `User ${user.id}` }))

/** Seerr's body for a new request: a movie, or a series' seasons; for a user, or as its admin. */
export const createBody = (request: CreateRequest, userId: number | undefined) => ({
  mediaType: request.kind === "movie" ? "movie" : "tv",
  mediaId: request.tmdbId,
  ...(request.kind === "series"
    ? { seasons: [...new Set(request.seasons ?? [])].sort((left, right) => left - right) }
    : {}),
  ...(userId === undefined ? {} : { userId })
})

/** What `POST /api/v1/request` answers: the new request, approved at once or waiting. */
export const CreatedRequest = Schema.Struct({ status: Schema.Number })

/** A decision on a request that no longer waits: approved, declined or deleted meanwhile. */
export class NotPending extends Data.TaggedError("NotPending")<{ readonly id: number }> {}

/**
 * Seerr's requests as Quai uses them, read through Quai Home: those waiting, one as it is now, and
 * the decision on one. The titles requests ask for are read from Seerr once and kept in memory (a
 * request names only its TMDB id); nothing is written anywhere, a restarted Cloud reads them again.
 */
export class Seerr extends Context.Service<Seerr, {
  readonly details: (request: SeerrRequest) => Effect.Effect<TitleDetails | undefined, HomeOffline>
  /** The pending requests with their titles, or None when Seerr didn't answer. */
  readonly pending: Effect.Effect<Option.Option<ReadonlyArray<MediaRequest>>, HomeOffline>
  /** A request as it is now; None when Seerr didn't answer, `"gone"` when it was deleted. */
  readonly current: (id: number) => Effect.Effect<Option.Option<SeerrRequest | "gone">, HomeOffline>
  /**
   * Approves or declines a request that still waits; one decided or deleted meanwhile is
   * `NotPending`. Seerr not answering, or refusing, is a `RequestFailed` in its words. The caller
   * has the Hub read the requests again, so the Live Activity follows.
   */
  readonly decide: (
    id: number,
    decision: "approve" | "decline"
  ) => Effect.Effect<void, HomeOffline | NotPending | RequestFailed>
  /** The movies and series Seerr finds; None when it didn't answer. */
  readonly search: (query: string) => Effect.Effect<Option.Option<ReadonlyArray<SearchResult>>, HomeOffline>
  /** A series' seasons and where each stands; None when Seerr didn't answer or doesn't know it. */
  readonly seasons: (tmdbId: number) => Effect.Effect<Option.Option<ReadonlyArray<SeasonChoice>>, HomeOffline>
  /** Seerr's users; None when it didn't answer. */
  readonly users: Effect.Effect<Option.Option<ReadonlyArray<SeerrUser>>, HomeOffline>
  /**
   * Requests a movie or a series' seasons, as `userId` or as Seerr's admin. Seerr refusing (already
   * requested, a quota, a user it doesn't know) is a `RequestFailed` in its words.
   */
  readonly create: (
    request: CreateRequest,
    userId: number | undefined
  ) => Effect.Effect<"approved" | "pending", HomeOffline | RequestFailed>
}>()("quai/Seerr") {
  static readonly layer = Layer.effect(
    Seerr,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const cache = new Map<string, TitleDetails>()
      const details = (request: SeerrRequest) =>
        Effect.gen(function*() {
          const kind = kindOf(request) === "series" ? "tv" as const : "movie" as const
          const key = `${kind}:${request.media.tmdbId}`
          const known = cache.get(key)
          if (known !== undefined) return known
          const body = yield* reads.read({
            service: "seerr",
            path: detailsPath(kind, request.media.tmdbId),
            schema: SeerrTitle
          })
          const found = Option.flatMap(body, (title) => Option.fromNullishOr(titleDetails(title)))
          if (Option.isNone(found)) return undefined
          if (cache.size >= 500) cache.clear()
          cache.set(key, found.value)
          return found.value
        })
      const withTitles = (requests: ReadonlyArray<SeerrRequest>) =>
        Effect.forEach(
          waiting(requests),
          (request) => Effect.map(details(request), (found) => toMediaRequest(request, found)),
          { concurrency: 4 }
        )
      const current = (id: number) =>
        reads.read<SeerrRequest | "gone">({
          service: "seerr",
          path: requestPath(id),
          schema: SeerrRequest,
          notFound: "gone"
        })
      return {
        details,
        pending: Effect.flatMap(
          reads.read(pendingRead),
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (page) => Effect.map(withTitles(page.results), Option.some)
          })
        ),
        current,
        decide: (id, decision) =>
          Effect.gen(function*() {
            const now = yield* current(id)
            if (Option.isNone(now)) return yield* Effect.fail(new RequestFailed({ message: "Seerr didn't answer" }))
            if (now.value === "gone" || now.value.status !== RequestStatus.pending) {
              return yield* Effect.fail(new NotPending({ id }))
            }
            yield* reads.write({ service: "seerr", method: "POST", path: decisionPath(id, decision) }, (message) =>
              new RequestFailed({ message }))
          }),
        search: (query) =>
          Effect.map(
            reads.read({ service: "seerr", path: searchPath(query), schema: SeerrSearchPage }),
            Option.map(searchResults)
          ),
        seasons: (tmdbId) =>
          Effect.map(
            reads.read({ service: "seerr", path: detailsPath("tv", tmdbId), schema: SeerrSeries }),
            Option.map(seasonChoices)
          ),
        users: Effect.map(
          reads.read({ service: "seerr", path: usersPath, schema: SeerrUserPage }),
          Option.map(seerrUsers)
        ),
        create: (request, userId) =>
          Effect.gen(function*() {
            const body = yield* reads.write(
              { service: "seerr", method: "POST", path: createPath, body: createBody(request, userId) },
              (message) => new RequestFailed({ message })
            )
            // Seerr made it: an answer it can't read is still a request, waiting as far as Quai knows.
            const created = readJson(CreatedRequest, body)
            return Option.isSome(created) && created.value.status === RequestStatus.approved
              ? "approved" as const
              : "pending" as const
          })
      }
    })
  )
}

export const pendingWatchId = "seerr:pending"

/** Running activities of request flows: they follow a request still waiting. */
const followed = (context: WatchContext): ReadonlyArray<Activity> =>
  runningWhere(context, (_, flow) => flow.subject === "request")

/**
 * Whether some request flow on, whose filter takes this request, has no running activity for it
 * yet. Request flows don't expire (`flowProblem`), so a request still pending keeps its activity
 * and is never started twice.
 */
const unfollowed = (context: WatchContext, request: SeerrRequest) => {
  const key = requestKey(request.id)
  const kind = kindOf(request)
  return context.flows.some((flow) =>
    flow.enabled && flow.subject === "request" &&
    ((flow.filter.mediaType ?? "any") === "any" || flow.filter.mediaType === kind) &&
    !context.running.some((activity) => activity.flowId === flow.id && activity.subjectKey === key)
  )
}

/** What became of a request that left the pending list: approved, declined, or deleted. */
export const outcome = (activity: Activity, request: SeerrRequest | "gone"): ReadonlyArray<FlowEvent> => {
  if (request === "gone") {
    // Deleted: what it was is gone too, so every request flow, whatever its filter, ends it.
    return TitleKind.literals.map((mediaType) => ({
      type: "request.declined" as const,
      subject: { kind: "request" as const, key: activity.subjectKey, title: activity.title, mediaType, requester: "" },
      values: { detail: "Removed" }
    }))
  }
  if (request.status === RequestStatus.pending) return []
  const requester = requesterOf(request)
  const subject: Subject = {
    kind: "request",
    key: activity.subjectKey,
    title: activity.title,
    mediaType: kindOf(request),
    requester
  }
  return request.status === RequestStatus.declined
    ? [{ type: "request.declined", subject, values: { detail: "Declined" } }]
    : [{ type: "request.approved", subject, values: { detail: requester } }]
}

export const seerr = Effect.gen(function*() {
  const requests = yield* Seerr

  // The same decision as the Requests screen's: only on a request that still waits.
  const decide = (decision: "approve" | "decline"): ActionHandler => (activity) => {
    const id = requestIdOf(activity.subjectKey)
    if (id === null) return Effect.fail(new InvalidAction({ message: "Not a request." }))
    return requests.decide(id, decision).pipe(
      Effect.catchTags({
        NotPending: () =>
          Effect.fail(new InvalidAction({ message: "This request was already approved, declined or removed." })),
        RequestFailed: (error) => Effect.fail(new InvalidAction({ message: `Seerr: ${error.message}` })),
        HomeOffline: (error) => Effect.fail(new InvalidAction({ message: `Seerr: ${error.message}` }))
      })
    )
  }

  const actions: Partial<Record<ActionType, ActionHandler>> = {
    "request.approve": decide("approve"),
    "request.decline": decide("decline")
  }

  const integration: Integration = {
    service: "seerr",
    webhook: { read: (body) => Effect.map(decodeSeerrWebhook(body), seerrEvents) },
    watcher: {
      watches: (context) => anyEnabledFlow(context, "request") ? [watchOf(pendingWatchId, pendingRead, 60)] : [],
      read: (snapshot, context) =>
        Effect.gen(function*() {
          const page = yield* readSnapshot(pendingRead, snapshot)
          if (Option.isNone(page)) return []
          const pending = waiting(page.value.results)
          const started = yield* Effect.forEach(
            pending.filter((request) => unfollowed(context, request)),
            (request) =>
              Effect.map(requests.details(request), (details) => pendingEvent(toMediaRequest(request, details))),
            { concurrency: 4 }
          )
          // Approved or declined elsewhere (Seerr's own page) and the notification missed: ask.
          const ids = new Set(pending.map((request) => requestKey(request.id)))
          const left = [...new Map(
            followed(context).filter((activity) => !ids.has(activity.subjectKey)).map((
              activity
            ) => [activity.subjectKey, activity])
          ).values()]
          const ended = yield* Effect.forEach(left, (activity) => {
            const id = requestIdOf(activity.subjectKey)
            return id === null
              ? Effect.succeed([])
              : Effect.map(
                requests.current(id),
                Option.match({ onNone: () => [], onSome: (found) => outcome(activity, found) })
              )
          }, { concurrency: 4 })
          return [...started, ...ended.flat()]
        }).pipe(Effect.catchTag("HomeOffline", (error) => Effect.as(Effect.logDebug(`seerr: ${error.message}`), [])))
    },
    actions
  }
  return integration
})
