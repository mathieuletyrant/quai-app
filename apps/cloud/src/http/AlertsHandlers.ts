import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Alerts } from "../alerts/Alerts.ts"

/** The app's Home: the alerts still going. */
export const AlertsHandlers = HttpApiBuilder.group(QuaiApi, "alerts", (handlers) =>
  Effect.gen(function*() {
    const alerts = yield* Alerts
    return handlers.handle("active", () => alerts.active)
  }))

/** The console's Alerts page. */
export const ConsoleAlertsHandlers = HttpApiBuilder.group(QuaiApi, "consoleAlerts", (handlers) =>
  Effect.gen(function*() {
    const alerts = yield* Alerts
    return handlers
      .handle("settings", () => alerts.settings)
      .handle("save", ({ payload }) => alerts.saveSettings(payload))
  }))
