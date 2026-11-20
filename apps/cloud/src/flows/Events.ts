import type { EventType } from "@quai/api"

/**
 * How to find a title in the media server: set by the service that imported it, read by the one
 * that says it's ready. Travels with the activity.
 */
export type MediaLookup =
  | { readonly _tag: "Movie"; readonly tmdbId: number; readonly title: string }
  | {
    readonly _tag: "Episodes"
    readonly tvdbId: number
    readonly title: string
    readonly episodes: ReadonlyArray<{ readonly season: number; readonly episode: number }>
  }

/** What one activity follows. `key` is unique per subject: `movie:tmdb:1`, `playback:<session>:<item>`, `service:radarr`, `request:12`. */
export type Subject =
  | {
    readonly kind: "media"
    readonly key: string
    readonly title: string
    readonly mediaType: "movie" | "series"
    readonly lookup?: MediaLookup
  }
  | { readonly kind: "playback"; readonly key: string; readonly title: string; readonly device: string }
  | { readonly kind: "service"; readonly key: string; readonly title: string }
  | {
    readonly kind: "request"
    readonly key: string
    readonly title: string
    readonly mediaType: "movie" | "series"
    readonly requester: string
  }

/** Live values an event can carry. Times are epoch milliseconds. */
export interface Values {
  readonly progress?: number
  readonly bytesPerSecond?: number
  readonly remainingSeconds?: number
  readonly endsAt?: number
  /** With `endsAt`: when the timeline began, so the iPhone can animate the bar itself. */
  readonly startsAt?: number
  readonly paused?: boolean
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
export const requestKey = (requestId: number) => `request:${requestId}`
