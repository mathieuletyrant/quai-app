import { RelayProtocol } from "@quai/api"
import { Clock, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { timingSafeEqual } from "node:crypto"
import { HomeKey } from "./HomeKey.ts"
import { Link } from "./Link.ts"

/** The URL a service should call, as seen from its container. */
export const webhookUrl = (internalUrl: string, service: string, token: string) =>
  `${internalUrl}/webhooks/${service}?token=${encodeURIComponent(token)}`

const sameToken = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * `POST /webhooks/<service>` forwards the payload to the Core as it is; `GET /health` says
 * whether the Relay is linked, and as which home.
 */
export const WebhooksLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const link = yield* Link
    const key = yield* HomeKey

    yield* router.add("GET", "/health", Effect.map(link.linked, (linked) =>
      HttpServerResponse.jsonUnsafe({ status: "ok", linked, homeId: key.homeId })))

    for (const service of RelayProtocol.webhookServices) {
      yield* router.add("POST", `/webhooks/${service}`, Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const given = new URL(request.url, "http://relay").searchParams.get("token") ?? ""
        if (!sameToken(given, key.webhookToken)) return HttpServerResponse.empty({ status: 401 })
        const body = yield* request.json
        const receivedAt = yield* Clock.currentTimeMillis
        yield* link.send(RelayProtocol.WebhookReceived.make({ service, receivedAt, body }))
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(
        Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      ))
    }
  })
)
