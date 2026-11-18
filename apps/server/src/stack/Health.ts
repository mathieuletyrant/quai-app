import { Clock, Context, Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { FlowEvent } from "../flows/Events.ts"
import { StackConfig } from "./StackConfig.ts"

/** A service is reported down after failing this long, as the spec's default (docs/spec-v1.md). */
export const downAfterMs = 5 * 60_000

interface Probe {
  readonly name: string
  readonly title: string
  readonly request: HttpClientRequest.HttpClientRequest
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
      const key = (k: Redacted.Redacted<string>) => Redacted.value(k)
      const probes: Array<Probe> = []
      if (config.radarr) {
        probes.push({ name: "radarr", title: "Radarr", request: HttpClientRequest.get(`${config.radarr.url}/api/v3/system/status`).pipe(HttpClientRequest.setHeader("X-Api-Key", key(config.radarr.apiKey))) })
      }
      if (config.sonarr) {
        probes.push({ name: "sonarr", title: "Sonarr", request: HttpClientRequest.get(`${config.sonarr.url}/api/v3/system/status`).pipe(HttpClientRequest.setHeader("X-Api-Key", key(config.sonarr.apiKey))) })
      }
      if (config.jellyfin) {
        probes.push({ name: "jellyfin", title: "Jellyfin", request: HttpClientRequest.get(`${config.jellyfin.url}/System/Info/Public`) })
      }
      if (config.qbittorrent) {
        // Answers 403 without a session: that still proves it's up.
        probes.push({ name: "qbittorrent", title: "qBittorrent", request: HttpClientRequest.get(`${config.qbittorrent.url}/api/v2/app/version`) })
      }
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
