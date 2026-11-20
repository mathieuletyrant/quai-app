import { HomeOffline, type MediaRequests, RequestFailed } from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { HomeLink, offlineMessage, toOffline } from "../home/HomeLink.ts"
import { serviceError } from "../home/HomeReads.ts"
import { Hub } from "../integrations/Hub.ts"
import { decisionPath, RequestStatus, SeerrTitles } from "../integrations/seerr.ts"

type RequestError = HomeOffline | HttpApiError.NotFound | RequestFailed

/**
 * Seerr's requests waiting for approval, read through Quai Home when the app or the console asks
 * (nothing is kept), and the two decisions on one of them. A decision ends its Live Activity: the
 * Hub has Quai Home read the pending requests again at once.
 */
export class Requests extends Context.Service<Requests, {
  readonly list: Effect.Effect<MediaRequests, HomeOffline>
  readonly decide: (id: string, decision: "approve" | "decline") => Effect.Effect<void, RequestError>
}>()("quai/Requests") {
  static readonly layer = Layer.effect(
    Requests,
    Effect.gen(function*() {
      const link = yield* HomeLink
      const titles = yield* SeerrTitles
      const hub = yield* Hub

      const reaches = Effect.gen(function*() {
        const home = yield* link.home
        if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
        return home.value.services.includes("seerr")
      })

      return {
        list: Effect.gen(function*() {
          if (!(yield* reaches)) return { items: [], status: "notConfigured" as const }
          const pending = yield* Effect.mapError(titles.pending, toOffline)
          return Option.match(pending, {
            onNone: () => ({ items: [], status: "unavailable" as const }),
            onSome: (items) => ({ items: [...items].sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0)), status: "ok" as const })
          })
        }),

        decide: (raw, decision) =>
          Effect.gen(function*() {
            const id = Number(raw)
            if (!(yield* reaches) || !/^\d+$/.test(raw) || id <= 0) return yield* Effect.fail(new HttpApiError.NotFound())
            // Only a request that still waits: one approved or declined meanwhile is a 404.
            const current = yield* Effect.mapError(titles.current(id), toOffline)
            if (Option.isNone(current)) return yield* Effect.fail(new RequestFailed({ message: "Seerr didn't answer" }))
            if (current.value === "gone" || current.value.status !== RequestStatus.pending) return yield* Effect.fail(new HttpApiError.NotFound())
            const response = yield* link.call({ service: "seerr", method: "POST", path: decisionPath(id, decision) }).pipe(
              Effect.catchTag("HomeError", (error) =>
                Effect.fail(error.reason === "offline" ? toOffline(error) : new RequestFailed({ message: `Quai Home: ${error.message}` })))
            )
            if (response.status >= 300) return yield* Effect.fail(new RequestFailed({ message: serviceError(response.status, response.body) }))
            yield* hub.refresh("seerr")
          })
      }
    })
  )
}
