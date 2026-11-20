import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { AlertKind } from "./Activity.ts"
import { DeviceAuth, HomeRequired } from "./Devices.ts"

/**
 * Alerts: something wrong that may last (a service down, the disk filling up, a problem Radarr
 * reports). Unlike a Live Activity, an alert is a plain notification, sent once when it starts and
 * once when it's over; the app's Home shows the ones still going.
 */

export const alertKinds: ReadonlyArray<AlertKind> = AlertKind.literals

/** Which alerts are on, and their thresholds. Set in the console's Alerts page, kept by Quai Home. */
export const AlertSettings = Schema.Struct({
  serviceDown: Schema.Struct({
    enabled: Schema.Boolean,
    /** A service that hasn't answered for this long is down. */
    afterMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 240 }))
  }),
  diskLow: Schema.Struct({
    enabled: Schema.Boolean,
    /** Under this share of the media disk free, in percent. Over by 2 points again: over. */
    belowPercent: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))
  }),
  arrHealth: Schema.Struct({
    enabled: Schema.Boolean,
    /** What Radarr, Sonarr and Prowlarr report on their System > Status page, from this level up. */
    level: Schema.Literals(["warning", "error"])
  })
}).annotate({ identifier: "AlertSettings" })
export type AlertSettings = typeof AlertSettings.Type

export const defaultAlertSettings: AlertSettings = {
  serviceDown: { enabled: true, afterMinutes: 5 },
  diskLow: { enabled: true, belowPercent: 10 },
  arrHealth: { enabled: true, level: "error" }
}

/** The free space, in points above the threshold, at which a low disk is over: it doesn't flap around it. */
export const diskBackAbovePoints = 2

/** One alert still going. */
export const ActiveAlert = Schema.Struct({
  /** `<kind>:<scope>:<what>`: `serviceDown:radarr:down`. */
  id: Schema.String,
  kind: AlertKind,
  /** "Radarr isn't answering" */
  title: Schema.String,
  /** "87 GB free (4%)" */
  detail: Schema.optionalKey(Schema.String),
  /** Epoch milliseconds. */
  since: Schema.Number
}).annotate({ identifier: "ActiveAlert" })
export type ActiveAlert = typeof ActiveAlert.Type

export const ActiveAlerts = Schema.Struct({
  /** Oldest first. */
  items: Schema.Array(ActiveAlert),
  /** The alerts turned on: the app says "all good" only for what is watched. */
  enabled: Schema.Array(AlertKind)
}).annotate({ identifier: "ActiveAlerts" })
export type ActiveAlerts = typeof ActiveAlerts.Type

/** The app's Home: the alerts still going. */
export class AlertsGroup extends HttpApiGroup.make("alerts")
  .add(HttpApiEndpoint.get("active", "/alerts", { success: ActiveAlerts }).annotate(OpenApi.Identifier, "listAlerts"))
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api") {}

/** The console's Alerts page. */
export class ConsoleAlertsGroup extends HttpApiGroup.make("consoleAlerts")
  .add(
    HttpApiEndpoint.get("settings", "/alerts", { success: AlertSettings }).annotate(OpenApi.Identifier, "getAlertSettings"),
    HttpApiEndpoint.put("save", "/alerts", { payload: AlertSettings, success: AlertSettings }).annotate(OpenApi.Identifier, "saveAlertSettings")
  )
  .middleware(HomeRequired)
  .prefix("/console-api") {}
