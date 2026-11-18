import { Data } from "effect"

/** A *arr service, the download client or Jellyfin did not answer, or answered something we can't read. */
export class StackError extends Data.TaggedError("StackError")<{
  readonly service: "radarr" | "sonarr" | "qbittorrent" | "jellyfin"
  readonly message: string
  readonly cause?: unknown
}> {}
