import { AgentProtocol } from "@quai/api"
import { Effect, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHmac, timingSafeEqual } from "node:crypto"
import { AgentConfig } from "./Config.ts"
import { Link } from "./Link.ts"

/** The services that post webhooks to the agent. */
export const webhookServices = ["radarr", "sonarr", "jellyfin"] as const

/**
 * The secret webhooks carry in their URL. Derived from the agent token rather than random, so the
 * URL stored in Radarr and Sonarr still works after a restart, and changes when the token does.
 */
export const webhookToken = (agentToken: Redacted.Redacted<string>) =>
  createHmac("sha256", Redacted.value(agentToken)).update("webhooks").digest("hex").slice(0, 32)

/** The URL a service should call, as seen from its container. */
export const webhookUrl = (internalUrl: string, service: string, token: string) =>
  `${internalUrl}/webhooks/${service}?token=${encodeURIComponent(token)}`

const sameToken = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * `POST /webhooks/<service>` forwards the payload to the cloud as it is; `GET /health` says
 * whether the agent is linked.
 */
export const WebhooksLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const link = yield* Link
    const token = webhookToken((yield* AgentConfig).token)

    yield* router.add("GET", "/health", Effect.map(link.linked, (linked) => HttpServerResponse.jsonUnsafe({ status: "ok", linked })))

    for (const service of webhookServices) {
      yield* router.add("POST", `/webhooks/${service}`, Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const given = new URL(request.url, "http://agent").searchParams.get("token") ?? ""
        if (!sameToken(given, token)) return HttpServerResponse.empty({ status: 401 })
        const body = yield* request.json
        yield* link.send(AgentProtocol.WebhookReceived.make({ service, body }))
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(
        Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      ))
    }
  })
)
