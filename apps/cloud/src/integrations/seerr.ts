import { type ActionType, type HomeOffline, InvalidAction, type MediaRequest, RequestFailed } from "@quai/api"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import { type FlowEvent, requestKey, type Subject } from "../flows/Events.ts"
import { HomeReads, type Read } from "../home/HomeReads.ts"
import { type ActionHandler, anyEnabledFlow, type Integration, readJson, runningWhere, type WatchContext } from "./Integration.ts"
import { epochSeconds, knownYear } from "./arr.ts"

/**
 * Seerr (Jellyseerr, Overseerr): the requests of the household. Quai follows only those that wait
 * for an admin (status pending): a request Seerr approved on its own (an auto-approve user) never
 * waits, so it starts nothing and is never listed.
 *
 * Quai Home sets Seerr's webhook up when its one webhook agent is free (or already Quai's), so a
 * request comes at once. Quai Cloud also polls the pending requests every minute while a request
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
  posterPath !== undefined && posterPath !== null && /^\/[\w.-]+$/.test(posterPath) ? `https://image.tmdb.org/t/p/w342${posterPath}` : undefined

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
export const pendingRead: Read<typeof SeerrRequestPage.Type> = { service: "seerr", path: pendingPath, schema: SeerrRequestPage }

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

export const kindOf = (request: SeerrRequest): "movie" | "series" =>
  (request.type ?? request.media.mediaType) === "tv" ? "series" : "movie"

export const requesterOf = (request: SeerrRequest) => {
  const user = request.requestedBy
  const name = [user?.displayName, user?.username, user?.jellyfinUsername, user?.plexUsername, user?.email]
    .find((n): n is string => typeof n === "string" && n !== "")
  return name ?? "Someone"
}

export const titleDetails = (body: typeof SeerrTitle.Type): TitleDetails | undefined => {
  const title = body.title ?? body.name
  if (title === undefined || title === "") return undefined
  const date = body.releaseDate ?? body.firstAirDate
  const year = knownYear(date === undefined || date === null ? undefined : Number(date.slice(0, 4)))
  return { title, year, posterUrl: posterUrl(body.posterPath) }
}

/** "Julie · Movie · 2024", "Julie · Series · S1–2 · 4K". */
export const requestDetail = (requester: string, kind: "movie" | "series", options: {
  readonly year?: number | undefined
  readonly seasons?: ReadonlyArray<number>
  readonly is4k?: boolean | undefined
} = {}) => {
  const seasons = [...(options.seasons ?? [])].sort((a, b) => a - b)
  const range = seasons.length === 0
    ? undefined
    : seasons.length === 1
    ? `S${seasons[0]}`
    : seasons.every((s, i) => i === 0 || s === seasons[i - 1]! + 1)
    ? `S${seasons[0]}–${seasons[seasons.length - 1]}`
    : `${seasons.length} seasons`
  return [requester, kind === "movie" ? "Movie" : "Series", options.year, range, options.is4k === true ? "4K" : undefined]
    .filter((p) => p !== undefined).join(" · ")
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
    seasons: kind === "series" ? (request.seasons ?? []).map((s) => s.seasonNumber).sort((a, b) => a - b) : [],
    is4k: request.is4k === true
  }
}

/** Only what really waits: a request Seerr approved on its own is never pending. */
export const waiting = (requests: ReadonlyArray<SeerrRequest>) => requests.filter((r) => r.status === RequestStatus.pending)

const subjectOf = (request: { readonly id: number; readonly title: string; readonly kind: "movie" | "series"; readonly requester: string }): Subject => ({
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
  const n = Number(id)
  return kind === "request" && Number.isInteger(n) && n > 0 ? n : null
}

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
  readonly decide: (id: number, decision: "approve" | "decline") => Effect.Effect<void, HomeOffline | NotPending | RequestFailed>
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
          const body = yield* reads.read({ service: "seerr", path: detailsPath(kind, request.media.tmdbId), schema: SeerrTitle })
          const found = Option.flatMap(body, (title) => Option.fromNullishOr(titleDetails(title)))
          if (Option.isNone(found)) return undefined
          if (cache.size >= 500) cache.clear()
          cache.set(key, found.value)
          return found.value
        })
      const withTitles = (requests: ReadonlyArray<SeerrRequest>) =>
        Effect.forEach(waiting(requests), (r) => Effect.map(details(r), (d) => toMediaRequest(r, d)), { concurrency: 4 })
      const current = (id: number) => reads.read<SeerrRequest | "gone">({ service: "seerr", path: requestPath(id), schema: SeerrRequest, notFound: "gone" })
      return {
        details,
        pending: Effect.flatMap(
          reads.read(pendingRead),
          Option.match({ onNone: () => Effect.succeed(Option.none()), onSome: (page) => Effect.map(withTitles(page.results), Option.some) })
        ),
        current,
        decide: (id, decision) =>
          Effect.gen(function*() {
            const now = yield* current(id)
            if (Option.isNone(now)) return yield* Effect.fail(new RequestFailed({ message: "Seerr didn't answer" }))
            if (now.value === "gone" || now.value.status !== RequestStatus.pending) return yield* Effect.fail(new NotPending({ id }))
            yield* reads.write({ service: "seerr", method: "POST", path: decisionPath(id, decision) }, (message) => new RequestFailed({ message }))
          })
      }
    })
  )
}

export const pendingWatchId = "seerr:pending"

/** Running activities of request flows: they follow a request still waiting. */
const followed = (context: WatchContext): ReadonlyArray<Activity> => runningWhere(context, (_, flow) => flow.subject === "request")

/**
 * Whether some request flow on, whose filter takes this request, has no running activity for it
 * yet. Request flows don't expire (`flowProblem`), so a request still pending keeps its activity
 * and is never started twice.
 */
const unfollowed = (context: WatchContext, request: SeerrRequest) => {
  const key = requestKey(request.id)
  const kind = kindOf(request)
  return context.flows.some((f) =>
    f.enabled && f.subject === "request" &&
    ((f.filter.mediaType ?? "any") === "any" || f.filter.mediaType === kind) &&
    !context.running.some((a) => a.flowId === f.id && a.subjectKey === key)
  )
}

/** What became of a request that left the pending list: approved, declined, or deleted. */
export const outcome = (activity: Activity, request: SeerrRequest | "gone"): ReadonlyArray<FlowEvent> => {
  if (request === "gone") {
    // Deleted: what it was is gone too, so every request flow, whatever its filter, ends it.
    return (["movie", "series"] as const).map((mediaType) => ({
      type: "request.declined" as const,
      subject: { kind: "request" as const, key: activity.subjectKey, title: activity.title, mediaType, requester: "" },
      values: { detail: "Removed" }
    }))
  }
  if (request.status === RequestStatus.pending) return []
  const requester = requesterOf(request)
  const subject: Subject = { kind: "request", key: activity.subjectKey, title: activity.title, mediaType: kindOf(request), requester }
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
        NotPending: () => Effect.fail(new InvalidAction({ message: "This request was already approved, declined or removed." })),
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
      watches: (context) =>
        anyEnabledFlow(context, "request") ? [{ id: pendingWatchId, service: "seerr", path: pendingPath, everySeconds: 60 }] : [],
      read: ({ status, body }, context) =>
        Effect.gen(function*() {
          if (status !== 200) return yield* Effect.as(Effect.logWarning(`Seerr answered HTTP ${status}`), [])
          const page = readJson(SeerrRequestPage, body)
          if (Option.isNone(page)) return yield* Effect.as(Effect.logWarning("Seerr: could not read the requests"), [])
          const pending = waiting(page.value.results)
          const started = yield* Effect.forEach(
            pending.filter((r) => unfollowed(context, r)),
            (r) => Effect.map(requests.details(r), (details) => pendingEvent(toMediaRequest(r, details))),
            { concurrency: 4 }
          )
          // Approved or declined elsewhere (Seerr's own page) and the notification missed: ask.
          const ids = new Set(pending.map((r) => requestKey(r.id)))
          const left = [...new Map(followed(context).filter((a) => !ids.has(a.subjectKey)).map((a) => [a.subjectKey, a])).values()]
          const ended = yield* Effect.forEach(left, (activity) => {
            const id = requestIdOf(activity.subjectKey)
            return id === null
              ? Effect.succeed([])
              : Effect.map(requests.current(id), Option.match({ onNone: () => [], onSome: (r) => outcome(activity, r) }))
          }, { concurrency: 4 })
          return [...started, ...ended.flat()]
        }).pipe(Effect.catchTag("HomeOffline", (error) => Effect.as(Effect.logDebug(`seerr: ${error.message}`), [])))
    },
    actions
  }
  return integration
})
