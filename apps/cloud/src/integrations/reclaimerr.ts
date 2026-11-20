import { Schema } from "effect"
import type { Detected } from "../fixes/Detected.ts"
import * as FixId from "../fixes/FixId.ts"
import { epochSeconds, knownYear, posterOf } from "./arr.ts"
import type { RadarrMovie } from "./radarr.ts"
import type { SonarrSeries } from "./sonarr.ts"

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
  /** The title's TMDB id, a movie's or a series'. */
  tmdb_id: Schema.optional(Schema.NullOr(Schema.Number)),
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

/** The candidates Reclaimerr is going to delete (or move) by itself: a known date, not protected. */
export const deletionCandidates = (candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> =>
  candidates.filter((candidate) =>
    deleting.has(candidate.auto_delete_state) &&
    epochSeconds(candidate.auto_delete_eligible_at) !== undefined &&
    candidate.blockers?.includes("protected") !== true
  )

/** A movie candidate is Radarr's; a series, a season or an episode is Sonarr's. */
export const isMovie = (candidate: Candidate) => candidate.media_type === "movie"

/** What Radarr and Sonarr list, to find a candidate's poster (Reclaimerr gives none). */
export interface PosterSources {
  readonly movies?: ReadonlyArray<RadarrMovie> | undefined
  readonly series?: ReadonlyArray<SonarrSeries> | undefined
}

/** "Marvel's Agents of S.H.I.E.L.D." and "Marvels Agents of SHIELD" are the same title. */
const normalized = (title: string) => title.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

interface Listed {
  readonly title: string
  readonly year?: number | undefined
  readonly tmdbId?: number | undefined
  readonly images?: RadarrMovie["images"]
}

/** By TMDB id first; else by title, and year when both know it. None when it's ambiguous. */
const matching = (candidate: Candidate, listed: ReadonlyArray<Listed>): Listed | undefined => {
  const tmdbId = candidate.tmdb_id ?? 0
  const byId = tmdbId <= 0 ? undefined : listed.find((l) => l.tmdbId === tmdbId)
  if (byId !== undefined) return byId
  const title = normalized(candidate.title)
  const year = knownYear(candidate.year ?? undefined)
  const named = listed.filter((l) => normalized(l.title) === title)
  const dated = year === undefined ? named : named.filter((l) => knownYear(l.year) === undefined || knownYear(l.year) === year)
  return dated.length === 1 ? dated[0] : undefined
}

/** The candidate's poster, from the Radarr movie or Sonarr series it is. */
export const candidatePoster = (candidate: Candidate, sources: PosterSources): string | undefined => {
  const listed = isMovie(candidate) ? sources.movies : sources.series
  return listed === undefined ? undefined : posterOf(matching(candidate, listed)?.images)
}

/** The titles Reclaimerr is going to delete (or move) by itself, soonest first, with their posters when found. */
export const scheduledDeletions = (candidates: ReadonlyArray<Candidate>, sources: PosterSources = {}): ReadonlyArray<Detected> =>
  deletionCandidates(candidates)
    .map((candidate): Detected => {
      const deletesAt = epochSeconds(candidate.auto_delete_eligible_at)!
      const year = knownYear(candidate.year ?? undefined)
      const since = epochSeconds(candidate.created_at)
      const posterUrl = candidatePoster(candidate, sources)
      return {
        fix: {
          id: FixId.deletion(candidate.id),
          kind: "scheduledDeletion",
          service: "reclaimerr",
          title: candidate.title,
          ...(year === undefined ? {} : { year }),
          ...(posterUrl === undefined ? {} : { posterUrl }),
          reason: candidate.reason,
          ...(since === undefined ? {} : { since }),
          actions: ["keep", "dismiss"],
          deletion: { deletesAt, operation: candidate.delete_operation === "move" ? "move" : "delete" }
        },
        target: { kind: "candidate", candidateId: candidate.id }
      }
    })
    .sort((a, b) => (a.fix.deletion?.deletesAt ?? 0) - (b.fix.deletion?.deletesAt ?? 0))
