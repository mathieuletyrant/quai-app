import { Clock, Effect, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { FlowEvent } from "../flows/Events.ts"
import { StackConfig } from "../stack/StackConfig.ts"
import { anyEnabledFlow, type Integration } from "./Integration.ts"

/** A service is reported down after failing this long, as the spec's default (docs/spec-v1.md). */
export const downAfterMs = 5 * 60_000

export interface Probe {
  readonly name: string
  readonly title: string
  readonly request: HttpClientRequest.HttpClientRequest
}

/** How to ask each kind of service whether it's up. Only configured services are probed. */
export const probesFor = (config: StackConfig["Service"]): ReadonlyArray<Probe> => {
  const withKey = (url: string, path: string, apiKey: Redacted.Redacted<string>) =>
    HttpClientRequest.get(`${url}${path}`).pipe(HttpClientRequest.setHeader("X-Api-Key", Redacted.value(apiKey)))
  const table: ReadonlyArray<Probe | null> = [
    config.radarr && { name: "radarr", title: "Radarr", request: withKey(config.radarr.url, "/api/v3/system/status", config.radarr.apiKey) },
    config.sonarr && { name: "sonarr", title: "Sonarr", request: withKey(config.sonarr.url, "/api/v3/system/status", config.sonarr.apiKey) },
    config.jellyfin && { name: "jellyfin", title: "Jellyfin", request: HttpClientRequest.get(`${config.jellyfin.url}/System/Info/Public`) },
    // Answers 403 without a session: that still proves it's up.
    config.qbittorrent && { name: "qbittorrent", title: "qBittorrent", request: HttpClientRequest.get(`${config.qbittorrent.url}/api/v2/app/version`) }
  ]
  return table.filter((p): p is Probe => p !== null)
}

/** Turns probe results into service.down (after 5 min of failures, once) and service.up events. */
export const makeHealthState = () => {
  const failingSince = new Map<string, number>()
  const reported = new Set<string>()
  return (probe: Probe, up: boolean, now: number): FlowEvent | null => {
    const subject = { kind: "service" as const, key: `service:${probe.name}`, title: probe.title }
    if (up) {
      failingSince.delete(probe.name)
      return reported.delete(probe.name) ? { type: "service.up", subject } : null
    }
    const since = failingSince.get(probe.name) ?? now
    failingSince.set(probe.name, since)
    if (reported.has(probe.name) || now - since < downAfterMs) return null
    reported.add(probe.name)
    return { type: "service.down", subject, values: { since, detail: "Not answering" } }
  }
}

/**
 * Quai's own health checks of the configured services, every minute while a service flow is on.
 */
export const health = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  const probes = probesFor(yield* StackConfig)
  const observe = makeHealthState()
  const up = (probe: Probe) =>
    client.execute(probe.request).pipe(
      Effect.map((r) => r.status < 500),
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => false)
    )
  const integration: Integration = {
    service: "quai",
    pollers: [{
      name: "health",
      every: "1 minute",
      needed: (context) => probes.length > 0 && anyEnabledFlow(context, "service"),
      run: () =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const events: Array<FlowEvent> = []
          for (const probe of probes) {
            const event = observe(probe, yield* up(probe), now)
            if (event !== null) events.push(event)
          }
          return events
        })
    }],
    actions: {}
  }
  return integration
})
