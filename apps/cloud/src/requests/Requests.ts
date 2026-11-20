import { type HomeOffline, type MediaRequests, type RequestFailed } from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { HomeReads } from "../home/HomeReads.ts"
import { Hub } from "../integrations/Hub.ts"
import { Seerr } from "../integrations/seerr.ts"

type RequestError = HomeOffline | HttpApiError.NotFound | RequestFailed

/**
 * Seerr's requests waiting for approval, for the app (`/api/requests`): `Seerr`'s, in the routes'
 * terms. A decision ends its Live Activity: the
 * Hub has Quai Home read the pending requests again at once.
 */
export class Requests extends Context.Service<Requests, {
  readonly list: Effect.Effect<MediaRequests, HomeOffline>
  readonly decide: (id: string, decision: "approve" | "decline") => Effect.Effect<void, RequestError>
}>()("quai/Requests") {
  static readonly layer = Layer.effect(
    Requests,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const seerr = yield* Seerr
      const hub = yield* Hub

      const reaches = Effect.map(reads.services, (services) => services.includes("seerr"))

      return {
        list: Effect.gen(function*() {
          if (!(yield* reaches)) return { items: [], status: "notConfigured" as const }
          const pending = yield* seerr.pending
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
            yield* seerr.decide(id, decision).pipe(Effect.catchTag("NotPending", () => Effect.fail(new HttpApiError.NotFound())))
            yield* hub.refresh("seerr")
          })
      }
    })
  )
}
