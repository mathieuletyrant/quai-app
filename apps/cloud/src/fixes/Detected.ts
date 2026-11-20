import type { Fix } from "@quai/api"
import type { MovieTarget } from "./movies.ts"
import type { SeriesTarget } from "./series.ts"

/** A title Reclaimerr is going to delete: its candidate. */
export interface CandidateTarget {
  readonly kind: "candidate"
  readonly candidateId: number
}

/** What a fix acts on, kept next to it while the request lasts (never stored, never sent). */
export type FixTarget = MovieTarget | SeriesTarget | CandidateTarget

/** A problem a rule found, and what its fix acts on. */
export interface Detected<T = FixTarget> {
  readonly fix: Fix
  readonly target: T
}

/** A missing title waits this long for a grab before it's a problem. */
export const noSourceAfterMs = 2 * 3600_000
