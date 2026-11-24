import { CurrentDevice, QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Requests } from "../requests/Requests.ts"

/** Seerr for the app: `/api/requests` and `/api/search`, behind the iPhone's token. */
export const RequestsHandlers = HttpApiBuilder.group(QuaiApi, "requests", (handlers) =>
  Effect.gen(function*() {
    const requests = yield* Requests
    return handlers
      .handle("list", () => requests.list)
      .handle("approve", ({ params }) => requests.decide(params.id, "approve"))
      .handle("decline", ({ params }) => requests.decide(params.id, "decline"))
      .handle("create", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          return yield* requests.create(device, payload)
        }))
      .handle("users", () => requests.users)
      .handle("search", ({ query }) => requests.search(query.query))
      .handle("seasons", ({ params }) => requests.seasons(params.tmdbId))
  }))
