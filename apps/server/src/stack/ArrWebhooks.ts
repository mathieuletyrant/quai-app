import { Effect, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { StackError } from "./Errors.ts"
import type { ServiceEndpoint } from "./StackConfig.ts"

const Notification = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  implementation: Schema.String
})
const Notifications = Schema.Array(Notification)

/** The name Quai's webhook carries in Radarr and Sonarr, so it finds (and later removes) its own. */
export const webhookName = "Quai"

/** The notification Quai asks for. Radarr and Sonarr share the Webhook implementation. */
export const webhookBody = (service: "radarr" | "sonarr", url: string) => ({
  name: webhookName,
  implementation: "Webhook",
  configContract: "WebhookSettings",
  onGrab: true,
  onDownload: true,
  onUpgrade: true,
  ...(service === "radarr" ? { onMovieAdded: true } : { onSeriesAdd: true }),
  tags: [],
  fields: [
    { name: "url", value: url },
    { name: "method", value: 1 }
  ]
})

/**
 * Makes sure Radarr or Sonarr calls Quai: creates the webhook, or points the existing one at `url`.
 * One of Quai's two writes to the stack (docs/spec-v1.md, read-only by default).
 */
export const ensureWebhook = (service: "radarr" | "sonarr", endpoint: ServiceEndpoint, url: string) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const withKey = HttpClientRequest.setHeader("X-Api-Key", Redacted.value(endpoint.apiKey))
    const existing = yield* client.execute(HttpClientRequest.get(`${endpoint.url}/api/v3/notification`).pipe(withKey)).pipe(
      Effect.flatMap((r) => r.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Notifications))
    )
    const mine = existing.find((n) => n.name === webhookName && n.implementation === "Webhook")
    const body = webhookBody(service, url)
    const request = mine === undefined
      ? HttpClientRequest.post(`${endpoint.url}/api/v3/notification`)
      : HttpClientRequest.put(`${endpoint.url}/api/v3/notification/${mine.id}`)
    const response = yield* client.execute(
      request.pipe(withKey, HttpClientRequest.bodyJsonUnsafe(mine === undefined ? body : { ...body, id: mine.id }))
    )
    if (response.status >= 300) {
      return yield* Effect.fail(new Error(`HTTP ${response.status}: ${yield* response.text}`))
    }
    return mine === undefined ? "created" as const : "updated" as const
  }).pipe(Effect.mapError((cause) => new StackError({ service, message: "could not set up the webhook", cause })))
