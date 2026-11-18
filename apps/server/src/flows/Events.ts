import type { EventType } from "@quai/api"

/** What one activity follows. `key` is unique per subject: `movie:tmdb:1`, `playback:<session>:<item>`, `service:radarr`. */
export type Subject =
  | { readonly kind: "media"; readonly key: string; readonly title: string; readonly mediaType: "movie" | "series" }
  | { readonly kind: "playback"; readonly key: string; readonly title: string; readonly device: string }
  | { readonly kind: "service"; readonly key: string; readonly title: string }

/** Live values an event can carry. Times are epoch milliseconds. */
export interface Values {
  readonly progress?: number
  readonly bytesPerSecond?: number
  readonly remainingSeconds?: number
  readonly endsAt?: number
  readonly since?: number
  readonly detail?: string
}

/**
 * A normalized event from the stack (docs/flows.md, Event catalog). Step events carry a subject;
 * `download.progress` is routed by torrent id instead.
 */
export interface FlowEvent {
  readonly type: EventType
  readonly subject?: Subject
  readonly downloadId?: string
  readonly values?: Values
}

export const movieKey = (tmdbId: number) => `movie:tmdb:${tmdbId}`
export const seriesKey = (tvdbId: number) => `series:tvdb:${tvdbId}`
