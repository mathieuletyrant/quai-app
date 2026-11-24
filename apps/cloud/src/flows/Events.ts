import type { ActivityItem, EventType } from "@quai/api"

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

const episodeKey = (e: { readonly season: number; readonly episode: number }) => `${e.season}:${e.episode}`

/**
 * What an activity follows after a new event about its subject. A season pack's imports arrive one
 * webhook per episode: the episodes add up, never narrow to the last one imported. Any other
 * lookup replaces the current one.
 */
export const widenLookup = (current: MediaLookup | null, incoming: MediaLookup | null): MediaLookup | null => {
  if (incoming === null) return current
  if (current?._tag !== "Episodes" || incoming._tag !== "Episodes" || current.tvdbId !== incoming.tvdbId) return incoming
  const known = new Set(current.episodes.map(episodeKey))
  const added = incoming.episodes.filter((e) => !known.has(episodeKey(e)))
  return added.length === 0 ? current : { ...current, episodes: [...current.episodes, ...added] }
}

/** The event is about part of what the activity follows (one episode of the pack): its title would narrow it. */
export const narrowsLookup = (current: MediaLookup | null, incoming: MediaLookup | null): boolean => {
  if (current?._tag !== "Episodes" || incoming?._tag !== "Episodes" || current.tvdbId !== incoming.tvdbId) return false
  const known = new Set(current.episodes.map(episodeKey))
  return incoming.episodes.length < current.episodes.length && incoming.episodes.every((e) => known.has(episodeKey(e)))
}

/** What one activity follows. `key` is unique per subject: `movie:tmdb:1`, `playback:<session>:<item>`, `request:12`. */
export type Subject =
  | {
    readonly kind: "media"
    readonly key: string
    readonly title: string
    readonly mediaType: "movie" | "series"
    readonly lookup?: MediaLookup
  }
  | { readonly kind: "playback"; readonly key: string; readonly title: string; readonly device: string }
  | { readonly kind: "day"; readonly key: string; readonly title: string }
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
  /** A step showing a list: its lines. */
  readonly items?: ReadonlyArray<ActivityItem>
  /** With `items`: done, out of the whole list. */
  readonly here?: number
  readonly total?: number
}

/**
 * A normalized event from the stack (docs/flows.md, Event catalog). Step events carry a subject;
 * `download.progress` is routed by torrent id instead.
 */
export interface FlowEvent {
  readonly type: EventType
  /** Only for this flow (a day flow starting at its own time); absent: every flow it concerns. */
  readonly flowId?: string
  readonly subject?: Subject
  readonly downloadId?: string
  readonly values?: Values
}

export const movieKey = (tmdbId: number) => `movie:tmdb:${tmdbId}`
export const seriesKey = (tvdbId: number) => `series:tvdb:${tvdbId}`
export const requestKey = (requestId: number) => `request:${requestId}`
