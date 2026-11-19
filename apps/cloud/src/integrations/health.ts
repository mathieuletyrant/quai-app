import type { HomeProtocol } from "@quai/api"
import { Clock, Effect } from "effect"
import type { FlowEvent } from "../flows/Events.ts"
import { anyEnabledFlow, type Integration } from "./Integration.ts"

/** A service is reported down after failing this long, as the spec's default (docs/spec-v1.md). */
export const downAfterMs = 5 * 60_000

/** How to ask each service whether it's up: an allowlisted status endpoint, every minute. */
export const probes: Record<HomeProtocol.HomeService, { readonly title: string; readonly path: string }> = {
  radarr: { title: "Radarr", path: "/api/v3/system/status" },
  sonarr: { title: "Sonarr", path: "/api/v3/system/status" },
  qbittorrent: { title: "qBittorrent", path: "/api/v2/app/version" },
  jellyfin: { title: "Jellyfin", path: "/System/Info/Public" }
}

export const healthWatchId = (service: HomeProtocol.HomeService) => `health:${service}`

const subjectOf = (service: HomeProtocol.HomeService) =>
  ({ kind: "service" as const, key: `service:${service}`, title: probes[service].title })

/**
 * Turns what was observed into service.down (after 5 min of failures, once) and service.up
 * events. `observe` records an answer; `due` reports the services failing for 5 minutes by now.
 */
export const makeHealthState = () => {
  const failingSince = new Map<HomeProtocol.HomeService, number>()
  const reported = new Set<HomeProtocol.HomeService>()
  const due = (now: number): ReadonlyArray<FlowEvent> => {
    const events: Array<FlowEvent> = []
    for (const [service, since] of failingSince) {
      if (reported.has(service) || now - since < downAfterMs) continue
      reported.add(service)
      events.push({ type: "service.down", subject: subjectOf(service), values: { since, detail: "Not answering" } })
    }
    return events
  }
  return {
    observe: (service: HomeProtocol.HomeService, up: boolean, now: number): ReadonlyArray<FlowEvent> => {
      if (up) {
        failingSince.delete(service)
        return reported.delete(service) ? [{ type: "service.up", subject: subjectOf(service) }] : []
      }
      if (!failingSince.has(service)) failingSince.set(service, now)
      return due(now)
    },
    due
  }
}

/**
 * Quai's own health checks of the services Quai Home reaches, every minute while a service flow
 * is on. A 5xx or a failed read counts as down. While no home is connected, nothing is checked and
 * nothing is reported: the Hub only runs this for a connected home.
 */
export const health = Effect.sync((): Integration => {
  const state = makeHealthState()
  const serviceOf = (watch: HomeProtocol.Watch) => watch.service
  return {
    service: "quai",
    watcher: {
      watches: (context) =>
        anyEnabledFlow(context, "service")
          ? context.services.map((service) => ({ id: healthWatchId(service), service, path: probes[service].path, everySeconds: 60 }))
          : [],
      // Answers 403 without a session (qBittorrent) still prove it's up.
      read: ({ watch, status }) => Effect.map(Clock.currentTimeMillis, (now) => state.observe(serviceOf(watch), status < 500, now)),
      failed: (watch) => Effect.map(Clock.currentTimeMillis, (now) => state.observe(serviceOf(watch), false, now)),
      tick: () => Effect.map(Clock.currentTimeMillis, state.due)
    },
    actions: {}
  }
})
