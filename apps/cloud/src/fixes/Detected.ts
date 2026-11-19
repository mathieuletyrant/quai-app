import type { Fix } from "@quai/api"

/** What a fix acts on, kept next to it while the request lasts (never stored, never sent). */
export type FixTarget =
  | {
    readonly _tag: "Queue"
    readonly service: "radarr" | "sonarr"
    readonly queueId: number
    readonly downloadId: string | undefined
    readonly movieId: number | undefined
    readonly seriesId: number | undefined
    readonly seasonNumber: number | undefined
  }
  | { readonly _tag: "Candidate"; readonly candidateId: number }
  | { readonly _tag: "MissingMovie"; readonly movieId: number }
  | { readonly _tag: "MissingEpisodes"; readonly seriesId: number; readonly seasonNumber: number; readonly episodeIds: ReadonlyArray<number> }

/** A problem a rule found, and what its fix acts on. */
export interface Detected {
  readonly fix: Fix
  readonly target: FixTarget
}

/** A missing title waits this long for a grab before it's a problem. */
export const noSourceAfterMs = 2 * 3600_000
