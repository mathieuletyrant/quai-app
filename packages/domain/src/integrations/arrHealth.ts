import { type AlertSettings, journalSourceNames } from "@quai/api"
import { Effect, Option, Schema } from "effect"
import { type AlertState, alertState } from "../alerts/Alerts.ts"
import type { Read } from "../home/HomeReads.ts"
import { type Integration, readSnapshot, watchOf } from "./Integration.ts"

/** One line of an *arr's System > Status page. */
const HealthCheck = Schema.Struct({
  source: Schema.optional(Schema.String),
  type: Schema.String,
  message: Schema.String
})
export const HealthChecks = Schema.Array(HealthCheck)
export type HealthCheck = typeof HealthCheck.Type

type ArrService = "radarr" | "sonarr" | "prowlarr"

/** `GET /api/v3/health` (`/api/v1/health` on Prowlarr): what each one reports about itself. */
export const healthReads = {
  radarr: { service: "radarr", path: "/api/v3/health", schema: HealthChecks },
  sonarr: { service: "sonarr", path: "/api/v3/health", schema: HealthChecks },
  prowlarr: { service: "prowlarr", path: "/api/v1/health", schema: HealthChecks }
} as const satisfies Record<ArrService, Read<typeof HealthChecks.Type>>

const arrServices: ReadonlyArray<ArrService> = ["radarr", "sonarr", "prowlarr"]

export const arrHealthEverySeconds = 300

export const arrHealthWatchId = (service: ArrService) => `arr-health:${service}`

/** The *arr's levels, lowest first: `ok` and `notice` never alert. */
const levels = ["ok", "notice", "warning", "error"]

const reaches = (check: HealthCheck, level: AlertSettings["arrHealth"]["level"]) =>
  levels.indexOf(check.type.toLowerCase()) >= levels.indexOf(level)

/**
 * Every problem one *arr reports at the alert's level or above. A check is told apart by its
 * `source` (`IndexerStatusCheck`), else by its message.
 */
export const arrHealthState = (
  service: ArrService,
  checks: ReadonlyArray<HealthCheck>,
  level: AlertSettings["arrHealth"]["level"]
): AlertState => {
  const name = journalSourceNames[service]
  return alertState(
    "arrHealth",
    service,
    checks.filter((check) => reaches(check, level)).map((check) => ({
      what: check.source ?? check.message,
      title: `${name} reports a problem`,
      detail: check.message,
      over: `${name}: fixed — ${check.message}`
    }))
  )
}

const isArr = (service: string): service is ArrService => (arrServices as ReadonlyArray<string>).includes(service)

/** What Radarr, Sonarr and Prowlarr report on their System > Status page, every 5 minutes while the alert is on. */
export const arrHealth: Integration = {
  service: "quai",
  alertWatcher: {
    watches: (context) =>
      context.alerts.arrHealth.enabled
        ? arrServices.filter((service) => context.services.includes(service)).map((service) =>
          watchOf(arrHealthWatchId(service), healthReads[service], arrHealthEverySeconds)
        )
        : [],
    read: (snapshot, context) => {
      const service = snapshot.watch.service
      if (!isArr(service)) return Effect.succeed([])
      return Effect.map(readSnapshot(healthReads[service], snapshot), (checks) =>
        Option.match(checks, {
          onNone: () => [],
          onSome: (list) => [arrHealthState(service, list, context.alerts.arrHealth.level)]
        }))
    }
  },
  actions: {}
}
