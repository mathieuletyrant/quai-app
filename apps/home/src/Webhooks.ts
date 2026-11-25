import { HomeProtocol, journalSourceNames } from "@quai/api"
import { Clock, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { timingSafeEqual } from "node:crypto"
import { HomeKey } from "./HomeKey.ts"
import { Journal } from "./Journal.ts"
import { Link } from "./Link.ts"

/** The URL a service should call, as seen from its container. */
export const webhookUrl = (internalUrl: string, service: string, token: string) =>
  `${internalUrl}/webhooks/${service}?token=${encodeURIComponent(token)}`

const sameToken = (given: string, expected: string) =>
  given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))

/**
 * `POST /webhooks/<service>` forwards the payload to the cloud as it is; `GET /health` says
 * whether Quai Home is linked, and as which home.
 */
export const WebhooksLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const link = yield* Link
    const key = yield* HomeKey
    const journal = yield* Journal

    yield* router.add("GET", "/health", Effect.map(link.linked, (linked) =>
      HttpServerResponse.jsonUnsafe({ status: "ok", linked, homeId: key.homeId })))

    for (const service of HomeProtocol.webhookServices) {
      yield* router.add("POST", `/webhooks/${service}`, Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const given = new URL(request.url, "http://home").searchParams.get("token") ?? ""
        if (!sameToken(given, key.webhookToken)) return HttpServerResponse.empty({ status: 401 })
        const body = yield* request.json
        const receivedAt = yield* Clock.currentTimeMillis
        // The service only: what the payload means is for the Cloud to say.
        yield* journal.note({ level: "info", source: service, kind: "webhook.received", text: `${journalSourceNames[service]} sent a webhook` })
        yield* link.send(HomeProtocol.WebhookReceived.make({ service, receivedAt, body }))
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(
        Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      ))
    }
  })
)
