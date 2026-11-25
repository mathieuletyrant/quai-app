import { Schema } from "effect"

/**
 * The services: the apps of the media stack Quai talks to through Quai Home. Every other list of
 * services picks from this one (and keeps its own identifier, so the contract stays as it is).
 */
export const Service = Schema.Literals([
  "radarr",
  "sonarr",
  "qbittorrent",
  "jellyfin",
  "reclaimerr",
  "seerr",
  "cleanuparr",
  "prowlarr"
])
export type Service = typeof Service.Type
