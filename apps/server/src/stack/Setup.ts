import { Effect, Layer } from "effect"
import { webhookUrl } from "../http/Webhooks.ts"
import { Settings } from "../store/Settings.ts"
import { ensureWebhook } from "./ArrWebhooks.ts"
import { StackConfig } from "./StackConfig.ts"

/**
 * On start, makes sure Radarr and Sonarr call Quai. A service that doesn't answer is logged and
 * skipped: Quai still starts, and the next start tries again.
 */
export const WebhookSetupLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* StackConfig
    const { webhookToken } = yield* Settings
    if (config.internalUrl === null) {
      yield* Effect.logInfo("QUAI_INTERNAL_URL not set: not setting up the Radarr and Sonarr webhooks")
      return
    }
    const internalUrl = config.internalUrl
    for (const service of ["radarr", "sonarr"] as const) {
      const endpoint = config[service]
      if (endpoint === null) continue
      yield* ensureWebhook(service, endpoint, webhookUrl(internalUrl, service, webhookToken)).pipe(
        Effect.tap((result) => Effect.logInfo(`${service} webhook ${result}`)),
        Effect.catchTag("StackError", (e) => Effect.logWarning(`${service}: ${e.message}`, e.cause))
      )
    }
  }).pipe(Effect.forkScoped)
)
