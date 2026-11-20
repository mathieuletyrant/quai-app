import { Effect, Layer, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { HomeConfig } from "./Config.ts"
import { ServiceError } from "./Errors.ts"
import { HomeKey } from "./HomeKey.ts"
import { Journal } from "./Journal.ts"
import { ensureSeerrWebhook } from "./SeerrWebhook.ts"
import { ServiceAuth } from "./ServiceAuth.ts"
import { webhookUrl } from "./Webhooks.ts"

const Notifications = Schema.Array(Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  implementation: Schema.String
}))

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
 * Makes sure Radarr or Sonarr calls Quai Home: creates the webhook, or points the existing one at
 * `url`. Quai Home's own write to the stack, outside the cloud's allowlist.
 */
export const ensureWebhook = (service: "radarr" | "sonarr", url: string) =>
  Effect.gen(function*() {
    const auth = yield* ServiceAuth
    const existing = yield* auth.execute(service, HttpClientRequest.get("/api/v3/notification")).pipe(
      Effect.flatMap((r) => r.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Notifications))
    )
    const mine = existing.find((n) => n.name === webhookName && n.implementation === "Webhook")
    const body = webhookBody(service, url)
    const request = mine === undefined
      ? HttpClientRequest.post("/api/v3/notification")
      : HttpClientRequest.put(`/api/v3/notification/${mine.id}`)
    const response = yield* auth.execute(
      service,
      request.pipe(HttpClientRequest.bodyJsonUnsafe(mine === undefined ? body : { ...body, id: mine.id }))
    )
    if (response.status >= 300) {
      return yield* Effect.fail(new Error(`HTTP ${response.status}: ${yield* response.text}`))
    }
    return mine === undefined ? "created" as const : "updated" as const
  }).pipe(Effect.mapError((cause) => new ServiceError({ service, message: "could not set up the webhook", cause })))

/**
 * On start, makes sure Radarr, Sonarr and Seerr post their webhooks to Quai Home. A service that
 * doesn't answer is logged and skipped: the next start tries again.
 */
export const WebhookSetupLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* HomeConfig
    const { webhookToken: token } = yield* HomeKey
    const journal = yield* Journal
    if (config.internalUrl === null) {
      yield* Effect.logInfo("QUAI_INTERNAL_URL not set: not setting up the Radarr, Sonarr and Seerr webhooks")
      yield* journal.note({ level: "info", source: "home", kind: "webhook.skipped", text: "Webhooks not set up: QUAI_INTERNAL_URL isn't set" })
      return
    }
    const name = { radarr: "Radarr", sonarr: "Sonarr", seerr: "Seerr" } as const
    const done = (service: keyof typeof name, result: "created" | "updated") =>
      Effect.andThen(
        Effect.logInfo(`${service} webhook ${result}`),
        journal.note({ level: "info", source: service, kind: "webhook.setup", text: `${name[service]}'s webhook to Quai Home ${result}` })
      )
    const refused = (service: keyof typeof name, e: ServiceError) =>
      Effect.andThen(
        Effect.logWarning(`${service}: ${e.message}`, e.cause),
        journal.note({ level: "error", source: service, kind: "webhook.failed", text: `${name[service]}: ${e.message}` })
      )
    for (const service of ["radarr", "sonarr"] as const) {
      if (config[service] === null) continue
      yield* ensureWebhook(service, webhookUrl(config.internalUrl, service, token)).pipe(
        Effect.tap((result) => done(service, result)),
        Effect.catchTag("ServiceError", (e) => refused(service, e))
      )
    }
    if (config.seerr !== null) {
      yield* ensureSeerrWebhook(webhookUrl(config.internalUrl, "seerr", token), token).pipe(
        Effect.tap((result) =>
          result === "taken"
            ? Effect.andThen(
              Effect.logInfo("seerr: its webhook already posts elsewhere, left as it is; Quai Cloud polls the pending requests instead"),
              journal.note({ level: "warn", source: "seerr", kind: "webhook.taken", text: "Seerr's webhook already posts elsewhere: left as it is, Quai Cloud polls the requests instead" })
            )
            : done("seerr", result)),
        Effect.catchTag("ServiceError", (e) => refused("seerr", e))
      )
    }
  }).pipe(Effect.forkScoped)
)
