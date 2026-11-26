import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { AlertKind } from "./Activity.ts"
import { DeviceAuth, HomeRequired } from "./Devices.ts"
import { Service } from "./Service.ts"

/**
 * Alerts: something wrong that may last (a service down, the disk filling up, a problem Radarr
 * reports). Unlike a Live Activity, an alert is a plain notification, sent once when it starts and
 * once when it's over; the app's Home shows the ones still going.
 */

export const alertKinds: ReadonlyArray<AlertKind> = AlertKind.literals

/** Alert kinds a home may have stored under an older name (settings, alerts going on, muted alerts). */
const renamedAlertKinds: Readonly<Record<string, AlertKind>> = { deletionPlanned: "plannedDeletion" }

/** A kind as a home stored it, under its current name: `deletionPlanned` is `plannedDeletion`. */
export const currentAlertKind = (kind: unknown): unknown =>
  typeof kind === "string" ? renamedAlertKinds[kind] ?? kind : kind

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
  }),
  /** A title Reclaimerr is going to delete (or move) on its own: when it's planned, and the day before. */
  plannedDeletion: Schema.Struct({
    enabled: Schema.Boolean
  })
}).annotate({ identifier: "AlertSettings" })
export type AlertSettings = typeof AlertSettings.Type

export const defaultAlertSettings: AlertSettings = {
  serviceDown: { enabled: true, afterMinutes: 5 },
  diskLow: { enabled: true, belowPercent: 10 },
  arrHealth: { enabled: true, level: "error" },
  plannedDeletion: { enabled: true }
}

/** The free space, in points above the threshold, at which a low disk is over: it doesn't flap around it. */
export const diskBackAbovePoints = 2

/** A service as the app names one: where an alert comes from, what Quai Home reaches. */
export const AlertService = Service.annotate({ identifier: "Service" })

/** One alert still going. */
export const ActiveAlert = Schema.Struct({
  /** `<kind>:<scope>:<what>`: `serviceDown:radarr:down`. */
  id: Schema.String,
  kind: AlertKind,
  /** "Radarr isn't answering" */
  title: Schema.String,
  /** "87 GB free (4%)" */
  detail: Schema.optionalKey(Schema.String),
  /** The service it's about; absent when it's about the home itself (the media disk). */
  source: Schema.optionalKey(AlertService),
  /** Epoch milliseconds. */
  since: Schema.Finite
}).annotate({ identifier: "ActiveAlert" })
export type ActiveAlert = typeof ActiveAlert.Type

export const ActiveAlerts = Schema.Struct({
  /** Oldest first. */
  items: Schema.Array(ActiveAlert),
  /** The alerts turned on: the app says "all good" only for what is watched. */
  enabled: Schema.Array(AlertKind),
  /**
   * The services Quai Home reaches: the app offers only the notifications that can happen. Absent
   * from an older Cloud, or while Quai Home is away.
   */
  services: Schema.optionalKey(Schema.Array(AlertService))
}).annotate({ identifier: "ActiveAlerts" })
export type ActiveAlerts = typeof ActiveAlerts.Type

/** The app's Home: the alerts still going. */
export class AlertsGroup extends HttpApiGroup.make("alerts")
  .add(HttpApiEndpoint.get("active", "/alerts", { success: ActiveAlerts }).annotate(OpenApi.Identifier, "listAlerts"))
  .middleware(DeviceAuth)
  .middleware(HomeRequired)
  .prefix("/api")
{}

/** The console's Alerts page. */
export class ConsoleAlertsGroup extends HttpApiGroup.make("consoleAlerts")
  .add(
    HttpApiEndpoint.get("settings", "/alerts", { success: AlertSettings }).annotate(
      OpenApi.Identifier,
      "getAlertSettings"
    ),
    HttpApiEndpoint.put("save", "/alerts", { payload: AlertSettings, success: AlertSettings }).annotate(
      OpenApi.Identifier,
      "saveAlertSettings"
    )
  )
  .middleware(HomeRequired)
  .prefix("/console-api")
{}
