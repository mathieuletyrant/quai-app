import { Effect, type Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Watcher } from "../flows/Watcher.ts"
import { decodeRadarrWebhook, radarrAvailability, radarrEvents } from "../stack/Radarr.ts"
import { decodeSonarrWebhook, sonarrAvailability, sonarrEvents } from "../stack/Sonarr.ts"
import { Settings } from "../store/Settings.ts"

/**
 * Where Radarr and Sonarr post. Not part of the contract: only the *arr apps call it, with the
 * secret token Quai put in the URL when it set the webhook up.
 */
export const WebhooksLive = HttpRouter.use((router) =>
  Effect.gen(function*() {
    const watcher = yield* Watcher
    const { webhookToken } = yield* Settings

    const receive = <A>(
      decode: (u: unknown) => Effect.Effect<A, Schema.SchemaError>,
      handle: (payload: A) => Effect.Effect<void>
    ) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = new URL(request.url, "http://quai").searchParams.get("token")
        if (token !== webhookToken) return HttpServerResponse.empty({ status: 401 })
        const body = yield* request.json
        const payload = yield* decode(body)
        yield* handle(payload)
        return HttpServerResponse.empty({ status: 204 })
      }).pipe(
        Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
        Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))
      )

    yield* router.add("POST", "/webhooks/radarr", receive(decodeRadarrWebhook, (payload) =>
      watcher.handle(radarrEvents(payload), radarrAvailability(payload))))
    yield* router.add("POST", "/webhooks/sonarr", receive(decodeSonarrWebhook, (payload) =>
      watcher.handle(sonarrEvents(payload), sonarrAvailability(payload))))
  })
)

/** The URL Radarr or Sonarr should call, as seen from their containers. */
export const webhookUrl = (internalUrl: string, service: "radarr" | "sonarr", token: string) =>
  `${internalUrl}/webhooks/${service}?token=${encodeURIComponent(token)}`
