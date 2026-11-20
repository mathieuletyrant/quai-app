import type { HomeProtocol } from "@quai/api"
import { Clock, Effect } from "effect"
import { type AlertState, alertState } from "../alerts/Alerts.ts"
import type { Integration } from "./Integration.ts"

/** How to ask each service whether it's up: an allowlisted status endpoint, every minute. */
export const probes: Record<HomeProtocol.HomeService, { readonly title: string; readonly path: string }> = {
  radarr: { title: "Radarr", path: "/api/v3/system/status" },
  sonarr: { title: "Sonarr", path: "/api/v3/system/status" },
  prowlarr: { title: "Prowlarr", path: "/api/v1/system/status" },
  qbittorrent: { title: "qBittorrent", path: "/api/v2/app/version" },
  jellyfin: { title: "Jellyfin", path: "/System/Info/Public" },
  // Needs the `system:read` scope; without it Reclaimerr answers 403, which still says it's up.
  reclaimerr: { title: "Reclaimerr", path: "/api/v1/system" },
  // Public: answers without the key.
  seerr: { title: "Seerr", path: "/api/v1/status" }
}

export const healthWatchId = (service: HomeProtocol.HomeService) => `health:${service}`

const minutes = (ms: number) => {
  const count = Math.round(ms / 60_000)
  return count === 1 ? "1 minute" : `${count} minutes`
}

const down = (service: HomeProtocol.HomeService, afterMs: number): AlertState =>
  alertState("serviceDown", service, [{
    what: "down",
    title: `${probes[service].title} isn't answering`,
    detail: `No answer for ${minutes(afterMs)}`,
    over: `${probes[service].title} answers again`
  }])

const up = (service: HomeProtocol.HomeService): AlertState => alertState("serviceDown", service, [])

/**
 * Turns answers into alert states: down after `afterMs` of failures (once per streak), up on the
 * first answer after a streak, and on the first answer at all, which ends an alert left from
 * before a restart.
 */
export const makeHealthState = () => {
  const failingSince = new Map<HomeProtocol.HomeService, number>()
  const reported = new Set<HomeProtocol.HomeService>()
  const seen = new Set<HomeProtocol.HomeService>()
  const due = (now: number, afterMs: number): ReadonlyArray<AlertState> => {
    const states: Array<AlertState> = []
    for (const [service, since] of failingSince) {
      if (reported.has(service) || now - since < afterMs) continue
      reported.add(service)
      states.push(down(service, afterMs))
    }
    return states
  }
  return {
    observe: (service: HomeProtocol.HomeService, isUp: boolean, now: number, afterMs: number): ReadonlyArray<AlertState> => {
      const first = !seen.has(service)
      seen.add(service)
      if (isUp) {
        failingSince.delete(service)
        return reported.delete(service) || first ? [up(service)] : []
      }
      if (!failingSince.has(service)) failingSince.set(service, now)
      return due(now, afterMs)
    },
    due
  }
}

/**
 * Quai's own checks of the services Quai Home reaches, every minute while the Service down alert
 * is on. A 5xx or a failed read counts as down. While no home is connected, nothing is checked.
 */
export const health = Effect.sync((): Integration => {
  const state = makeHealthState()
  const afterMs = (minutesSetting: number) => minutesSetting * 60_000
  return {
    service: "quai",
    alertWatcher: {
      watches: (context) =>
        context.alerts.serviceDown.enabled
          ? context.services.map((service) => ({ id: healthWatchId(service), service, path: probes[service].path, everySeconds: 60 }))
          : [],
      // Answers 403 without a session (qBittorrent) still prove it's up.
      read: ({ watch, status }, context) =>
        Effect.map(Clock.currentTimeMillis, (now) => state.observe(watch.service, status < 500, now, afterMs(context.alerts.serviceDown.afterMinutes))),
      failed: (watch, _reason, context) =>
        Effect.map(Clock.currentTimeMillis, (now) => state.observe(watch.service, false, now, afterMs(context.alerts.serviceDown.afterMinutes))),
      tick: (context) => Effect.map(Clock.currentTimeMillis, (now) => state.due(now, afterMs(context.alerts.serviceDown.afterMinutes)))
    },
    actions: {}
  }
})
