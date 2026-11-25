import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceError } from "./Errors.ts"
import { ServiceAuth } from "./ServiceAuth.ts"

/** Seerr's webhook agent, `GET /api/v1/settings/notifications/webhook`: only the fields Quai reads. */
const WebhookSettings = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  types: Schema.optional(Schema.Number),
  options: Schema.optional(Schema.Struct({
    webhookUrl: Schema.optional(Schema.NullOr(Schema.String))
  }))
})
export type SeerrWebhookSettings = typeof WebhookSettings.Type

export const seerrWebhookPath = "/api/v1/settings/notifications/webhook"

/**
 * Seerr's notification types (server/lib/notifications/index.ts), a bitmask: a request waiting for
 * approval, approved, declined. Never `MEDIA_AUTO_APPROVED`: such a request waits for no one.
 */
export const seerrNotificationTypes = { MEDIA_PENDING: 2, MEDIA_APPROVED: 4, MEDIA_DECLINED: 64 } as const
export const seerrTypes = seerrNotificationTypes.MEDIA_PENDING | seerrNotificationTypes.MEDIA_APPROVED |
  seerrNotificationTypes.MEDIA_DECLINED

/**
 * What Seerr posts, in its template language: the type, the title (with its year), the poster,
 * the media and the request. `{{media}}` and `{{request}}` keys are Seerr's: null when the
 * notification has none.
 */
export const seerrPayloadTemplate = {
  notification_type: "{{notification_type}}",
  subject: "{{subject}}",
  image: "{{image}}",
  "{{media}}": { media_type: "{{media_type}}", tmdbId: "{{media_tmdbid}}", status: "{{media_status}}" },
  "{{request}}": { request_id: "{{request_id}}", requestedBy_username: "{{requestedBy_username}}" }
}

/** The settings Quai writes: Seerr keeps the template base64-encoded. */
export const seerrWebhookBody = (url: string) => ({
  enabled: true,
  types: seerrTypes,
  options: {
    webhookUrl: url,
    jsonPayload: Buffer.from(JSON.stringify(seerrPayloadTemplate, null, 2)).toString("base64")
  }
})

/** Whether a webhook URL is Quai Home's own receiver for Seerr, with this home's token. */
export const isQuaiReceiver = (webhookUrl: string, token: string) => {
  if (!URL.canParse(webhookUrl)) return false
  const url = new URL(webhookUrl)
  return url.pathname.endsWith("/webhooks/seerr") && url.searchParams.get("token") === token
}

/**
 * What to do with Seerr's one webhook agent. It holds a single URL, so Quai only takes it when
 * it has none, or already has Quai's own. Another URL is left untouched, even with the agent off
 * (its owner may turn it back on), and Quai Cloud's 60-second poll of the pending requests does
 * the job alone.
 */
export const seerrWebhookPlan = (settings: SeerrWebhookSettings, token: string): "create" | "update" | "taken" => {
  const current = (settings.options?.webhookUrl ?? "").trim()
  if (current === "") return "create"
  return isQuaiReceiver(current, token) ? "update" : "taken"
}

/**
 * Makes sure Seerr posts its request notifications to Quai Home, when its webhook agent is free or
 * already Quai's. Quai Home's own write to Seerr, outside the Cloud's allowlist.
 */
export const ensureSeerrWebhook = (url: string, token: string) =>
  Effect.gen(function*() {
    const auth = yield* ServiceAuth
    const refused = (message: string, cause?: unknown) =>
      new ServiceError({ service: "seerr", message: `could not set up the webhook: ${message}`, cause })
    const settings = yield* auth.execute("seerr", HttpClientRequest.get(seerrWebhookPath)).pipe(
      Effect.flatMap((response) =>
        response.status === 200
          ? Effect.mapError(response.json, (cause) => refused("unreadable settings", cause))
          : Effect.fail(refused(`HTTP ${response.status}`))
      ),
      Effect.flatMap((body) =>
        Effect.mapError(Schema.decodeUnknownEffect(WebhookSettings)(body), (cause) =>
          refused("unexpected settings", cause))
      )
    )
    const plan = seerrWebhookPlan(settings, token)
    if (plan === "taken") {
      return plan
    }
    const response = yield* auth.execute(
      "seerr",
      HttpClientRequest.post(seerrWebhookPath).pipe(HttpClientRequest.bodyJsonUnsafe(seerrWebhookBody(url)))
    )
    if (response.status >= 300) {
      const body = yield* Effect.orElseSucceed(response.text, () =>
        "")
      return yield* Effect.fail(refused(`HTTP ${response.status}: ${body}`))
    }
    return plan === "create" ? "created" as const : "updated" as const
  })
