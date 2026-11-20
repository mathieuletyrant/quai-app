import { Effect, Layer } from "effect"
import { Journal } from "../journal/Journal.ts"
import { arrHealth } from "./arrHealth.ts"
import { cleanuparr } from "./cleanuparr.ts"
import { disk } from "./disk.ts"
import { health } from "./health.ts"
import { Integrations } from "./Integration.ts"
import { jellyfin } from "./jellyfin.ts"
import { qbittorrent } from "./qbittorrent.ts"
import { radarr } from "./radarr.ts"
import { releases } from "./releases.ts"
import { Seerr, seerr } from "./seerr.ts"
import { sonarr } from "./sonarr.ts"

/**
 * The integrations of this Cloud, and the Seerr requests they share with the Requests list. Adding a
 * service: write its integration, list it here.
 */
export const IntegrationsLive = Layer.effect(
  Integrations,
  Effect.all([Effect.succeed(radarr), Effect.succeed(sonarr), Effect.succeed(qbittorrent), jellyfin, seerr, releases, health, Effect.map(Effect.service(Journal), cleanuparr), Effect.succeed(disk), Effect.succeed(arrHealth)])
).pipe(Layer.provideMerge(Seerr.layer))
