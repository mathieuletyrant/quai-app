import { type HomeOffline, type MediaRequest, type MediaRequests, type NewRequest, type RequestFailed, RequestsNotConfigured } from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { HomeReads } from "../home/HomeReads.ts"
import { requestKey } from "../flows/Events.ts"
import { Hub } from "../integrations/Hub.ts"
import { Seerr } from "../integrations/seerr.ts"
import { Journal } from "../journal/Journal.ts"

type RequestError = HomeOffline | HttpApiError.NotFound | RequestFailed

/**
 * Seerr's requests waiting for approval, for the app (`/api/requests`): `Seerr`'s, in the routes'
 * terms. A decision ends its Live Activity: the
 * Hub has Quai Home read the pending requests again at once.
 */
export class Requests extends Context.Service<Requests, {
  readonly list: Effect.Effect<MediaRequests, HomeOffline>
  readonly decide: (id: string, decision: "approve" | "decline") => Effect.Effect<void, RequestError>
  /** Asks Seerr for a title; then has the Hub read the requests again, like a decision. */
  readonly create: (request: NewRequest) => Effect.Effect<void, HomeOffline | RequestFailed | RequestsNotConfigured>
}>()("quai/Requests") {
  static readonly layer = Layer.effect(
    Requests,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const seerr = yield* Seerr
      const hub = yield* Hub
      const journal = yield* Journal

      const reaches = Effect.map(reads.services, (services) => services.includes("seerr"))
      /** What the last list said of each request, to name it in the journal. */
      const listed = new Map<number, MediaRequest>()
      const named = (id: number, decision: "approve" | "decline") => {
        const r = listed.get(id)
        const verb = decision === "approve" ? "Approved" : "Declined"
        return r === undefined
          ? { text: `${verb} Seerr request #${id}` }
          : { text: `${verb} ${r.requester}'s request for ${r.title}`, title: r.title }
      }

      return {
        list: Effect.gen(function*() {
          if (!(yield* reaches)) return { items: [], status: "notConfigured" as const }
          const pending = yield* seerr.pending
          return Option.match(pending, {
            onNone: () => ({ items: [], status: "unavailable" as const }),
            onSome: (items) => {
              listed.clear()
              for (const item of items) listed.set(item.id, item)
              return { items: [...items].sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0)), status: "ok" as const }
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

        create: ({ kind, tmdbId }) =>
          Effect.gen(function*() {
            if (!(yield* reaches)) return yield* Effect.fail(new RequestsNotConfigured({ message: "Quai Home has no Seerr: nothing can be requested." }))
            const title = (yield* seerr.titleOf(kind, tmdbId))?.title
            const named = title === undefined ? `TMDB ${tmdbId}` : title
            yield* journal.outcome(
              { level: "info", source: "seerr", kind: "request.created", text: `Requested ${named} in Seerr`, ...(title === undefined ? {} : { title }) },
              seerr.request(kind, tmdbId)
            )
            yield* hub.refresh("seerr")
          })
      }
    })
  )
}
