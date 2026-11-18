import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Hub } from "../integrations/Hub.ts"
import { Integrations } from "../integrations/Integration.ts"
import { Settings } from "../store/Settings.ts"

/**
 * `/webhooks/<service>`, one route per integration that pushes. Not part of the contract: only
 * the services call it, with the secret token Quai put in the URL when it set the webhook up.
 */
export const WebhooksLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const hub = yield* Hub
    const { webhookToken } = yield* Settings
    for (const integration of yield* Integrations) {
      const webhook = integration.webhook
      if (webhook === undefined) continue
      yield* router.add("POST", `/webhooks/${integration.service}`, Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = new URL(request.url, "http://quai").searchParams.get("token")
        if (token !== webhookToken) return HttpServerResponse.empty({ status: 401 })
        yield* hub.apply(yield* webhook.read(yield* request.json))
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(
        Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
        Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      ))
    }
  })
)

/** The URL a service should call, as seen from its container. */
export const webhookUrl = (internalUrl: string, service: string, token: string) =>
  `${internalUrl}/webhooks/${service}?token=${encodeURIComponent(token)}`
