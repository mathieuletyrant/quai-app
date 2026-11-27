import type { Fix } from "@quai/api"
import type { MovieTarget } from "./movies.ts"
import type { SeriesTarget } from "./series.ts"

/** A title Reclaimerr is going to delete: its candidate. */
export interface CandidateTarget {
  readonly kind: "candidate"
  readonly candidateId: number
}

/** A download Cleanuparr is going to remove from a queue: the one it struck, and the *arr's id of it. */
export interface RemovalTarget {
  readonly kind: "removal"
  readonly downloadItemId: string
  readonly downloadId: string
}

/** What a fix acts on, kept next to it while the request lasts (never stored, never sent). */
export type FixTarget = MovieTarget | SeriesTarget | CandidateTarget | RemovalTarget

/** A problem a rule found, and what its fix acts on. */
export interface Detected<T = FixTarget> {
  readonly fix: Fix
  readonly target: T
}

/** A missing title waits this long for a grab before it's a problem. */
export const noSourceAfterMs = 2 * 3600_000
