import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Requests } from "../requests/Requests.ts"

/** Seerr's requests for the app: `/api/requests`, behind the iPhone's token. */
export const RequestsHandlers = HttpApiBuilder.group(QuaiApi, "requests", (handlers) =>
  Effect.gen(function*() {
    const requests = yield* Requests
    return handlers
      .handle("list", () => requests.list)
      .handle("approve", ({ params }) => requests.decide(params.id, "approve"))
      .handle("decline", ({ params }) => requests.decide(params.id, "decline"))
  }))

