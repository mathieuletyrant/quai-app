import {
  type CreateRequest,
  type DeviceId,
  HomeOffline,
  HomeProtocol,
  type MediaRequest,
  type MediaRequests,
  RequestFailed,
  type RequestCreated,
  type SearchResults,
  type SearchStatus,
  type SeerrUsers,
  type SeriesSeasons
} from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { Devices } from "../home/Devices.ts"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { requestKey } from "../flows/Events.ts"
import { Hub } from "../integrations/Hub.ts"
import { Seerr } from "../integrations/seerr.ts"
import { Journal } from "../journal/Journal.ts"

type RequestError = HomeOffline | HttpApiError.NotFound | RequestFailed

/** A search longer than this is not a title. */
const maxQueryLength = 200

/**
 * Seerr for the app: the requests waiting for approval (`/api/requests`), and the search that
 * requests a title (`/api/search`), `Seerr`'s in the routes' terms. A decision ends its Live
 * Activity, and a new request may start one: the Hub has Quai Home read the pending requests
 * again at once.
 */
export class Requests extends Context.Service<Requests, {
  readonly list: Effect.Effect<MediaRequests, HomeOffline>
  readonly decide: (id: string, decision: "approve" | "decline") => Effect.Effect<void, RequestError>
  readonly search: (query: string) => Effect.Effect<SearchResults, HomeOffline>
  readonly seasons: (tmdbId: string) => Effect.Effect<SeriesSeasons, RequestError>
  readonly users: Effect.Effect<SeerrUsers, HomeOffline>
  /** Requests a title as the Seerr user this iPhone chose, or as Seerr's admin. */
  readonly create: (
    device: { readonly id: DeviceId; readonly name: string },
    request: CreateRequest
  ) => Effect.Effect<RequestCreated, RequestError>
}>()("quai/Requests") {
  static readonly layer = Layer.effect(
    Requests,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const link = yield* HomeLink
      const seerr = yield* Seerr
      const hub = yield* Hub
      const journal = yield* Journal
      const devices = yield* Devices

      const reaches = Effect.map(reads.services, (services) => services.includes("seerr"))
      /**
       * Whether the search, the users and new requests can go: `ok`, or why not. A Home older
       * than protocol 8 would refuse them.
       */
      const searchable = Effect.gen(function*() {
        const home = yield* link.home
        if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
        if (!home.value.services.includes("seerr")) return "notConfigured" as const
        if (home.value.protocol < HomeProtocol.searchProtocolVersion) return "outdated" as const
        return "ok" as const
      })
      const notSearchable = (status: Exclude<SearchStatus, "ok" | "unavailable">) =>
        status === "outdated"
          ? new RequestFailed({ message: "Update Quai Home to request from the app." })
          : new HttpApiError.NotFound()

      /** What the last list said of each request, to name it in the journal. */
      const listed = new Map<number, MediaRequest>()
      const named = (id: number, decision: "approve" | "decline") => {
        const request = listed.get(id)
        const verb = decision === "approve" ? "Approved" : "Declined"
        return request === undefined
          ? { text: `${verb} Seerr request #${id}` }
          : { text: `${verb} ${request.requester}'s request for ${request.title}`, title: request.title }
      }
      /** What the last search found, to name a request in the journal. */
      const found = new Map<string, string>()

      const users = Effect.gen(function*(): Effect.fn.Return<SeerrUsers, HomeOffline> {
        const status = yield* searchable
        if (status !== "ok") return { items: [], status }
        return Option.match(yield* seerr.users, {
          onNone: () => ({ items: [], status: "unavailable" as const }),
          onSome: (items) => ({ items, status: "ok" as const })
        })
      })

      return {
        list: Effect.gen(function*() {
          if (!(yield* reaches)) return { items: [], status: "notConfigured" as const }
          const pending = yield* seerr.pending
          return Option.match(pending, {
            onNone: () => ({ items: [], status: "unavailable" as const }),
            onSome: (items) => {
              listed.clear()
              for (const item of items) listed.set(item.id, item)
              return { items: [...items].sort((left, right) => (left.requestedAt ?? 0) - (right.requestedAt ?? 0)), status: "ok" as const }
            }
          })
        }),

        decide: (raw, decision) =>
          Effect.gen(function*() {
            const id = Number(raw)
            if (!(yield* reaches) || !/^\d+$/.test(raw) || id <= 0) return yield* Effect.fail(new HttpApiError.NotFound())
            // Only a request that still waits: one approved or declined meanwhile is a 404.
            yield* journal.outcome(
              { level: "info", source: "seerr", kind: `request.${decision}`, subject: requestKey(id), ...named(id, decision) },
              seerr.decide(id, decision).pipe(Effect.catchTag("NotPending", () => Effect.fail(new HttpApiError.NotFound())))
            )
            yield* hub.refresh("seerr")
          }),

        search: (raw) =>
          Effect.gen(function*() {
            const status = yield* searchable
            const query = raw.trim().slice(0, maxQueryLength)
            if (status !== "ok") return { items: [], status }
            if (query === "") return { items: [], status: "ok" as const }
            return Option.match(yield* seerr.search(query), {
              onNone: () => ({ items: [], status: "unavailable" as const }),
              onSome: (items) => {
                if (found.size >= 500) found.clear()
                for (const item of items) found.set(`${item.kind}:${item.tmdbId}`, item.title)
                return { items, status: "ok" as const }
              }
            })
          }),

        seasons: (raw) =>
          Effect.gen(function*() {
            const tmdbId = Number(raw)
            if (!/^\d+$/.test(raw) || tmdbId <= 0) return yield* Effect.fail(new HttpApiError.NotFound())
            const status = yield* searchable
            if (status !== "ok") return yield* Effect.fail(notSearchable(status))
            const seasons = yield* seerr.seasons(tmdbId)
            if (Option.isNone(seasons)) return yield* Effect.fail(new RequestFailed({ message: "Seerr didn't answer" }))
            return { seasons: seasons.value }
          }),

        users,

        create: (device, request) =>
          Effect.gen(function*() {
            const status = yield* searchable
            if (status !== "ok") return yield* Effect.fail(notSearchable(status))
            if (request.kind === "series" && (request.seasons ?? []).length === 0) {
              return yield* Effect.fail(new RequestFailed({ message: "Choose at least one season." }))
            }
            if (request.kind === "movie" && request.seasons !== undefined && request.seasons.length > 0) {
              return yield* Effect.fail(new RequestFailed({ message: "A movie has no seasons." }))
            }
            const userId = (yield* devices.preferences(device.id)).seerrUserId
            const title = found.get(`${request.kind}:${request.tmdbId}`) ?? `TMDB ${request.tmdbId}`
            const asked = userId === undefined
              ? undefined
              : Option.getOrUndefined(Option.flatMap(yield* seerr.users, (all) => Option.fromNullishOr(all.find((user) => user.id === userId)?.name)))
            const forWhom = asked === undefined ? "" : ` for ${asked}`
            const created = yield* journal.outcome(
              { level: "info", source: "seerr", kind: "request.created", title, text: `Requested ${title}${forWhom} from ${device.name}` },
              seerr.create(request, userId)
            )
            yield* hub.refresh("seerr")
            return { status: created }
          })
      }
    })
  )
}
