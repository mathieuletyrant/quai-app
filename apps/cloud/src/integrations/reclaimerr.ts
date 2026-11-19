import { Schema } from "effect"
import type { Detected } from "../fixes/Detected.ts"
import { epochSeconds, knownYear } from "./radarr.ts"

/**
 * Reclaimerr (github.com/jessielw/Reclaimerr): rule-based cleanup for Jellyfin, Plex and Emby. Its
 * external API, `/api/v1`, takes a scoped bearer token (Settings > Integrations); Quai needs
 * `candidates:manage` (which grants `candidates:read`), and `system:read` for its health check.
 *
 * No events and no Live Activity action: it only feeds the To fix list, so it isn't one of the
 * Hub's integrations. Read when the list is asked for.
 */

/** The cleanup candidates, newest first. 200 is the API's largest page. */
export const candidatesPath = "/api/v1/candidates?page=1&per_page=200"

/** Protects the candidate's title for good: automatic and manual cleanup both skip it. */
export const protectPath = (candidateId: number) => `/api/v1/candidates/${candidateId}/protect`

export const protectReason = "Kept from Quai"

/** `CandidateStatusResponse` (backend/models/api_v1/candidates.py), only the fields Quai reads. */
const Candidate = Schema.Struct({
  id: Schema.Number,
  media_type: Schema.String,
  title: Schema.String,
  year: Schema.optional(Schema.NullOr(Schema.Number)),
  /** The matched rules, in words: "Old and unwatched: Last watched over 365 days ago". */
  reason: Schema.String,
  delete_operation: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.String),
  /** disabled (no rule deletes it on its own), scheduled, eligible (goes at the next run), postponed, canceled. */
  auto_delete_state: Schema.String,
  auto_delete_eligible_at: Schema.optional(Schema.String),
  /** "protected", "pending_protection_request", "pending_delete_request". */
  blockers: Schema.optional(Schema.Array(Schema.String))
})
export type Candidate = typeof Candidate.Type

export const CandidatePage = Schema.Struct({ items: Schema.Array(Candidate) })

/** The states in which Reclaimerr deletes the title on its own, at a known date. */
const deleting = new Set(["scheduled", "eligible", "postponed"])

/** The titles Reclaimerr is going to delete (or move) by itself, soonest first. */
export const scheduledDeletions = (candidates: ReadonlyArray<Candidate>): ReadonlyArray<Detected> =>
  candidates
    .flatMap((candidate): ReadonlyArray<Detected> => {
      const deletesAt = epochSeconds(candidate.auto_delete_eligible_at)
      if (!deleting.has(candidate.auto_delete_state) || deletesAt === undefined) return []
      if (candidate.blockers?.includes("protected") === true) return []
      const year = knownYear(candidate.year ?? undefined)
      const since = epochSeconds(candidate.created_at)
      return [{
        fix: {
          id: `deletion-${candidate.id}`,
          kind: "scheduledDeletion",
          service: "reclaimerr",
          title: candidate.title,
          ...(year === undefined ? {} : { year }),
          reason: candidate.reason,
          ...(since === undefined ? {} : { since }),
          actions: ["keep", "dismiss"],
          deletion: { deletesAt, operation: candidate.delete_operation === "move" ? "move" : "delete" }
        },
        target: { _tag: "Candidate", candidateId: candidate.id }
      }]
    })
    .sort((a, b) => (a.fix.deletion?.deletesAt ?? 0) - (b.fix.deletion?.deletesAt ?? 0))
