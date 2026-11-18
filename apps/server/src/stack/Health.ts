import { Clock, Context, Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { FlowEvent } from "../flows/Events.ts"
import { StackConfig } from "./StackConfig.ts"

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

/**
 * Health checks for the configured services. A service that doesn't answer for 5 min gives
 * `service.down` once; the first answer after that gives `service.up`.
 */
export class Health extends Context.Service<Health, {
  readonly check: Effect.Effect<ReadonlyArray<FlowEvent>>
}>()("quai/Health") {
  static readonly layer = Layer.effect(
    Health,
    Effect.gen(function*() {
      const config = yield* StackConfig
      const client = yield* HttpClient.HttpClient
      const probes = probesFor(config)
      const failingSince = new Map<string, number>()
      const reported = new Set<string>()

      const up = (probe: Probe) =>
        client.execute(probe.request).pipe(
          Effect.map((r) => r.status < 500),
          Effect.timeout("10 seconds"),
          Effect.orElseSucceed(() => false)
        )

      return {
        check: Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const events: Array<FlowEvent> = []
          for (const probe of probes) {
            const subject = { kind: "service" as const, key: `service:${probe.name}`, title: probe.title }
            if (yield* up(probe)) {
              failingSince.delete(probe.name)
              if (reported.delete(probe.name)) events.push({ type: "service.up", subject })
              continue
            }
            const since = failingSince.get(probe.name) ?? now
            failingSince.set(probe.name, since)
            if (!reported.has(probe.name) && now - since >= downAfterMs) {
              reported.add(probe.name)
              events.push({ type: "service.down", subject, values: { since, detail: "Not answering" } })
            }
          }
          return events
        })
      }
    })
  )
}
