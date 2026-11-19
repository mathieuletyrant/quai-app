import { Effect, Layer } from "effect"
import { health } from "./health.ts"
import { Integrations } from "./Integration.ts"
import { jellyfin } from "./jellyfin.ts"
import { qbittorrent } from "./qbittorrent.ts"
import { radarr } from "./radarr.ts"
import { sonarr } from "./sonarr.ts"

/** The integrations of this Cloud. Adding a service: write its integration, list it here. */
export const IntegrationsLive = Layer.effect(
  Integrations,
  Effect.all([Effect.succeed(radarr), Effect.succeed(sonarr), Effect.succeed(qbittorrent), jellyfin, health])
)
