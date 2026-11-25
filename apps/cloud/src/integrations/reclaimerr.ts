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
 * No events and no Live Activity action: it feeds the To fix list, read when the list is asked for,
 * and the Planned deletion alert (`deletions.ts`), which reads the candidates every minute.
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
  /** What goes: a movie, one of its versions, a series, a season, an episode. */
  scope: Schema.optional(Schema.NullOr(Schema.String)),
  season_number: Schema.optional(Schema.NullOr(Schema.Number)),
  /** What the files weigh. */
  size_bytes: Schema.optional(Schema.NullOr(Schema.Number)),
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

/**
 * A candidate's reason, readable: Reclaimerr writes its rule's name, then each condition with what it
 * found, `Watched movies not revisited: Library matches any f137… (f137…), Never watched is false
 * (9 views; last watched 2026-11-04 21:35:11.102901), Days since watched > 15 (16)`. Kept: the rule's
 * name and what each condition found, `Watched movies not revisited · 9 views; last watched
 * 2026-11-04 · 16 days since watched`. Library conditions say nothing to the reader; a condition
 * Quai can't read is kept as written.
 */
export const reasonSummary = (reason: string): string => {
  const colon = reason.indexOf(": ")
  if (colon < 0) return withDays(reason)
  const rule = reason.slice(0, colon)
  const facts = conditionsOf(reason.slice(colon + 2))
    .filter((condition) => !condition.startsWith("Library "))
    .map(factOf)
  return [rule, ...facts].map(withDays).join(" · ")
}

/** Conditions are separated by ", " or " | ", but never inside the parentheses of what was found. */
const conditionsOf = (text: string): ReadonlyArray<string> => {
  const parts: Array<string> = []
  let depth = 0
  let current = ""
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (character === "(") depth++
    if (character === ")") depth--
    const separator = depth === 0 && (text.startsWith(", ", index) || text.startsWith(" | ", index))
    if (separator) {
      parts.push(current.trim())
      current = ""
      index += text.startsWith(", ", index) ? 1 : 2
      continue
    }
    current += character
  }
  if (current.trim() !== "") parts.push(current.trim())
  return parts
}

const conditionPattern = /^(.+?) (is|is not|>|>=|<|<=|=|!=) (.+?) \((.+)\)$/

/** "Days since watched > 15 (16)" → "16 days since watched"; "Never watched is false (9 views…)" → "9 views…". */
const factOf = (condition: string): string => {
  const match = conditionPattern.exec(condition)
  if (match === null) return condition
  const [, label, operator, , found] = match as unknown as [string, string, string, string, string]
  if (label.startsWith("Days since ")) return `${found} days since ${label.slice("Days since ".length).toLowerCase()}`
  if (operator === "is" || operator === "is not") return found
  return `${label}: ${found}`
}

/** "2026-11-04 21:35:11.102901" → "2026-11-04". */
const withDays = (text: string) => text.replace(/(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}(\.\d+)?/g, "$1")

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
  readonly id: number
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

/**
 * The library title a candidate deletes whole, as Upcoming's space back keys it: `movie:<radarr id>`,
 * `series:<sonarr id>`, a season `series:<id>:s<n>`. Undefined when it isn't found, when only an
 * episode goes, or when Reclaimerr moves it (its files go elsewhere).
 */
export const candidateTitleKey = (candidate: Candidate, sources: PosterSources): string | undefined => {
  if (candidate.delete_operation === "move") return undefined
  const listed = isMovie(candidate) ? sources.movies : sources.series
  const found = listed === undefined ? undefined : matching(candidate, listed)
  if (found === undefined) return undefined
  if (isMovie(candidate)) return `movie:${found.id}`
  const scope = candidate.scope ?? "series"
  if (scope === "season" && candidate.season_number !== undefined && candidate.season_number !== null) return `series:${found.id}:s${candidate.season_number}`
  return ["series", "show", "tv"].includes(scope) ? `series:${found.id}` : undefined
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
          reason: reasonSummary(candidate.reason),
          ...(since === undefined ? {} : { since }),
          actions: ["keep", "dismiss"],
          deletion: { deletesAt, operation: candidate.delete_operation === "move" ? "move" : "delete" }
        },
        target: { kind: "candidate", candidateId: candidate.id }
      }
    })
    .sort((a, b) => (a.fix.deletion?.deletesAt ?? 0) - (b.fix.deletion?.deletesAt ?? 0))
