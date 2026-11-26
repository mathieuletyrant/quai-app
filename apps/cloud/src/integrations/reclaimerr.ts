import type { PlannedDeletion } from "@quai/api"
import { Cron, Result, Schema } from "effect"
import type { Detected } from "../fixes/Detected.ts"
import * as FixId from "../fixes/FixId.ts"
import type { Read } from "../home/HomeReads.ts"
import * as LibraryId from "../library/LibraryId.ts"
import { epochSeconds, knownYear, posterOf } from "./arr.ts"
import type { RadarrMovie } from "./radarr.ts"
import type { SonarrSeries } from "./sonarr.ts"

/**
 * Reclaimerr (github.com/jessielw/Reclaimerr): rule-based cleanup for Jellyfin, Plex and Emby. Its
 * external API, `/api/v1`, takes a scoped bearer token (Settings > Integrations); Quai needs
 * `candidates:manage` (which grants `candidates:read`), `system:read` for its health check, and
 * `tasks:read` for when its deletion task runs.
 *
 * No events and no Live Activity action. Its planned deletions (`plannedDeletions`) are decided here
 * once and shown three ways: a fix on the To fix list, the Planned deletion alert
 * (`plannedDeletionAlert.ts`) and a row of Upcoming.
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

/** The candidates, as the To fix list, Upcoming and the Planned deletion alert's watch read them. */
export const candidatesRead: Read<typeof CandidatePage.Type> = {
  service: "reclaimerr",
  path: candidatesPath,
  schema: CandidatePage
}

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

/** Reclaimerr's task that deletes the candidates whose delay is over: once a day by default, at 02:00. */
export const deletionTaskPath = "/api/v1/tasks/delete_cleanup_candidates"

/** `TaskResponse` (backend/models/api_v1/tasks.py), only the fields Quai reads. */
const DeletionTask = Schema.Struct({
  enabled: Schema.Boolean,
  /** "cron", "interval" (seconds) or "manual". */
  schedule_type: Schema.String,
  schedule_value: Schema.String,
  next_run_at: Schema.optional(Schema.NullOr(Schema.String))
})
export type DeletionTask = typeof DeletionTask.Type

/** The deletion task, to tell when a candidate really goes. */
export const deletionTaskRead: Read<DeletionTask> = {
  service: "reclaimerr",
  path: deletionTaskPath,
  schema: DeletionTask
}

/** When a candidate goes: `exact` when the deletion task's schedule says it, else the earliest. */
export interface DeletionRun {
  readonly at: number
  readonly exact: boolean
}

/** The run of a cron schedule from `due` on, when its next run is one of its own (Reclaimerr's clock in UTC). */
const cronRunFrom = (value: string, next: number, due: number): number | undefined => {
  const parsed = Cron.parse(value, "UTC")
  if (Result.isFailure(parsed) || !Cron.match(parsed.success, new Date(next * 1000))) return undefined
  return Math.floor(Cron.next(parsed.success, new Date(due * 1000 - 1000)).getTime() / 1000)
}

/** The first run of the deletion task from `due` (epoch seconds) on, `next` being its next one. */
const runFrom = (task: DeletionTask, next: number, due: number): number | undefined => {
  if (next >= due) return next
  if (task.schedule_type === "interval") {
    const every = Number(task.schedule_value)
    return every > 0 ? next + Math.ceil((due - next) / every) * every : undefined
  }
  return task.schedule_type === "cron" ? cronRunFrom(task.schedule_value, next, due) : undefined
}

/**
 * When Reclaimerr deletes a candidate whose delay ends at `due`: at the first run of its deletion task
 * from then on, not at `due` itself. None while the task is off: nothing then goes on its own. Without
 * the task (a key lacking `tasks:read`, an older Quai Home) or a schedule Quai can't follow, `due`
 * at the earliest.
 */
export const deletionRun = (due: number, task: DeletionTask | undefined): DeletionRun | undefined => {
  if (task === undefined) return { at: due, exact: false }
  if (!task.enabled || task.schedule_type === "manual") return undefined
  const next = epochSeconds(task.next_run_at ?? undefined)
  const at = next === undefined ? undefined : runFrom(task, next, due)
  return at === undefined ? { at: due, exact: false } : { at, exact: true }
}

/** The states in which Reclaimerr deletes the title on its own, at a known date. */
const deleting = new Set(["scheduled", "eligible", "postponed"])

/**
 * A planned deletion: a candidate Reclaimerr is going to delete (or move) by itself, at `deletesAt`
 * (epoch seconds, its deletion task's run: `exact`, else the earliest; it may be past, then it goes at
 * the next run).
 */
export interface PlannedCandidate extends PlannedDeletion {
  readonly candidate: Candidate
  readonly exact: boolean
}

/**
 * Every planned deletion: a deleting state, a known date, not protected, a deletion task that runs
 * (`deletionRun`). Soonest first.
 */
export const plannedDeletions = (
  candidates: ReadonlyArray<Candidate>,
  task: DeletionTask | undefined
): ReadonlyArray<PlannedCandidate> =>
  candidates
    .flatMap((candidate): ReadonlyArray<PlannedCandidate> => {
      const due = epochSeconds(candidate.auto_delete_eligible_at)
      if (
        !deleting.has(candidate.auto_delete_state) || due === undefined ||
        candidate.blockers?.includes("protected") === true
      ) return []
      const run = deletionRun(due, task)
      if (run === undefined) return []
      const operation = candidate.delete_operation === "move" ? "move" : "delete"
      return [{ candidate, deletesAt: run.at, exact: run.exact, operation }]
    })
    .sort((left, right) => left.deletesAt - right.deletesAt)

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

/** A list of titles by TMDB id (the first with it) and by normalized title, in the list's order. */
interface Titles {
  readonly byTmdbId: ReadonlyMap<number, Listed>
  readonly byTitle: ReadonlyMap<string, ReadonlyArray<Listed>>
}

/** Each list's index, made once however many candidates look it up. */
const indexes = new WeakMap<ReadonlyArray<Listed>, Titles>()

const titlesOf = (listed: ReadonlyArray<Listed>): Titles => {
  const known = indexes.get(listed)
  if (known !== undefined) return known
  const byTmdbId = new Map<number, Listed>()
  const byTitle = new Map<string, Array<Listed>>()
  for (const entry of listed) {
    if (entry.tmdbId !== undefined && !byTmdbId.has(entry.tmdbId)) byTmdbId.set(entry.tmdbId, entry)
    const title = normalized(entry.title)
    const named = byTitle.get(title)
    if (named === undefined) byTitle.set(title, [entry])
    else named.push(entry)
  }
  const titles = { byTmdbId, byTitle }
  indexes.set(listed, titles)
  return titles
}

/** By TMDB id first; else by title, and year when both know it. None when it's ambiguous. */
const matching = (candidate: Candidate, listed: ReadonlyArray<Listed>): Listed | undefined => {
  const titles = titlesOf(listed)
  const tmdbId = candidate.tmdb_id ?? 0
  const byId = tmdbId <= 0 ? undefined : titles.byTmdbId.get(tmdbId)
  if (byId !== undefined) return byId
  const year = knownYear(candidate.year ?? undefined)
  const named = titles.byTitle.get(normalized(candidate.title)) ?? []
  const dated = year === undefined
    ? named
    : named.filter((entry) => knownYear(entry.year) === undefined || knownYear(entry.year) === year)
  return dated.length === 1 ? dated[0] : undefined
}

/** A movie version and the Radarr movie are the same files when their sizes are within this share. */
const sameSizeShare = 0.02

/** One version among those the media server has is Radarr's whole file only when it weighs the same. */
const isRadarrFile = (candidate: Candidate, movie: RadarrMovie) => {
  const size = candidate.size_bytes ?? 0
  const onDisk = movie.sizeOnDisk ?? 0
  return size > 0 && Math.abs(size - onDisk) <= onDisk * sameSizeShare
}

const movieTitleKey = (
  candidate: Candidate,
  scope: string,
  movies: ReadonlyArray<RadarrMovie> | undefined
): LibraryId.LibraryId | undefined => {
  const movie = movies === undefined ? undefined : matching(candidate, movies) as RadarrMovie | undefined
  if (movie === undefined) return undefined
  if (scope === "movie") return LibraryId.movie(movie.id)
  return scope === "version" && isRadarrFile(candidate, movie) ? LibraryId.movie(movie.id) : undefined
}

const seriesTitleKey = (
  candidate: Candidate,
  scope: string,
  series: ReadonlyArray<SonarrSeries> | undefined
): LibraryId.LibraryId | undefined => {
  const found = series === undefined ? undefined : matching(candidate, series)
  if (found === undefined) return undefined
  if (scope === "season" && candidate.season_number !== undefined && candidate.season_number !== null) {
    return LibraryId.season(found.id, candidate.season_number)
  }
  return ["series", "show", "tv"].includes(scope) ? LibraryId.series(found.id) : undefined
}

/**
 * The library title a candidate deletes whole, as Upcoming's space back keys it: `movie:<radarr id>`,
 * `series:<sonarr id>`, a season `series:<id>:s<n>`. Undefined when it isn't found, when only part
 * of it goes (an episode; a movie version other than Radarr's whole file), or when Reclaimerr moves
 * it (its files go elsewhere).
 */
export const candidateTitleKey = (
  { candidate, operation }: PlannedCandidate,
  sources: PosterSources
): LibraryId.LibraryId | undefined => {
  if (operation === "move") return undefined
  const scope = candidate.scope ?? (isMovie(candidate) ? "movie" : "series")
  return isMovie(candidate)
    ? movieTitleKey(candidate, scope, sources.movies)
    : seriesTitleKey(candidate, scope, sources.series)
}

/** The candidate's poster, from the Radarr movie or Sonarr series it is. */
export const candidatePoster = (candidate: Candidate, sources: PosterSources): string | undefined => {
  const listed = isMovie(candidate) ? sources.movies : sources.series
  return listed === undefined ? undefined : posterOf(matching(candidate, listed)?.images)
}

/** Planned deletions as fixes, soonest first, with their posters when found. */
export const plannedDeletionFixes = (
  planned: ReadonlyArray<PlannedCandidate>,
  sources: PosterSources = {}
): ReadonlyArray<Detected> =>
  planned.map(({ candidate, deletesAt, exact, operation }): Detected => {
    const year = knownYear(candidate.year ?? undefined)
    const since = epochSeconds(candidate.created_at)
    const posterUrl = candidatePoster(candidate, sources)
    return {
      fix: {
        id: FixId.deletion(candidate.id),
        kind: "plannedDeletion",
        service: "reclaimerr",
        title: candidate.title,
        ...(year === undefined ? {} : { year }),
        ...(posterUrl === undefined ? {} : { posterUrl }),
        reason: reasonSummary(candidate.reason),
        ...(since === undefined ? {} : { since }),
        actions: ["keep", "letGo"],
        deletion: { deletesAt, exact, operation }
      },
      target: { kind: "candidate", candidateId: candidate.id }
    }
  })

// Gone: what Reclaimerr carried out, from its event feed.

/** The feed's file events Gone reads: a title deleted, or moved elsewhere. */
export const fileEventTypes = ["candidate.deleted", "candidate.moved"] as const
export type FileEventType = typeof fileEventTypes[number]

/**
 * `EventResponse` (models/api_v1/events.py) of a file event: its payload is `CandidateFileEvent`
 * (models/lifecycle_events.py), only the fields Quai reads. Its own `candidate_id` is always null for
 * these: the candidate is in the payload.
 */
const FileEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  occurred_at: Schema.String,
  payload: Schema.Struct({
    action: Schema.optional(Schema.NullOr(Schema.String)),
    media_type: Schema.optional(Schema.NullOr(Schema.String)),
    /** The movie's or the series' title: a season or an episode is in its own fields. */
    title: Schema.optional(Schema.NullOr(Schema.String)),
    tmdb_id: Schema.optional(Schema.NullOr(Schema.Number)),
    candidate_id: Schema.optional(Schema.NullOr(Schema.Number)),
    season_number: Schema.optional(Schema.NullOr(Schema.Number)),
    episode_number: Schema.optional(Schema.NullOr(Schema.Number))
  })
})
export type FileEvent = typeof FileEvent.Type

/** The feed, oldest first: 200 is its largest page. */
const EventFeed = Schema.Struct({ items: Schema.Array(FileEvent) })

/** How far back the feed is read: the hour Gone notifies, and the hour it started in. */
const feedWindowMs = 3600_000

/**
 * The feed's events of one type since the start of the hour before `now`. The feed lists the oldest
 * first, so it is read from a recent point: the path changes once an hour, not at each read.
 */
export const fileEventsRead = (type: FileEventType, now: number): Read<typeof EventFeed.Type> => {
  const since = new Date(Math.floor((now - feedWindowMs) / feedWindowMs) * feedWindowMs).toISOString()
  return {
    service: "reclaimerr",
    path: `/api/v1/events?event_type=${type}&limit=200&occurred_after=${encodeURIComponent(since)}`,
    schema: EventFeed
  }
}

const twoDigits = (value: number) => String(value).padStart(2, "0")

/** "Vampire Diaries S07", "Percy Jackson S03E04": a season or an episode after its series' title. */
export const fileEventTitle = (event: FileEvent): string => {
  const title = event.payload.title ?? "A title"
  const season = event.payload.season_number ?? undefined
  if (season === undefined) return title
  const episode = event.payload.episode_number ?? undefined
  return `${title} S${twoDigits(season)}${episode === undefined ? "" : `E${twoDigits(episode)}`}`
}

/**
 * The candidate a file event carried out, as Reclaimerr last listed it (`known`), else from the
 * event: what space back is decided on. Its size is only known from the list.
 */
export const carriedOut = (event: FileEvent, known: Candidate | undefined, now: number): PlannedCandidate => {
  const payload = event.payload
  const episode = payload.episode_number ?? undefined
  const season = payload.season_number ?? undefined
  const candidate: Candidate = known ?? {
    id: payload.candidate_id ?? 0,
    media_type: payload.media_type ?? "movie",
    title: fileEventTitle(event),
    tmdb_id: payload.tmdb_id ?? null,
    scope: episode !== undefined ? "episode" : season !== undefined ? "season" : payload.media_type ?? "movie",
    season_number: season ?? null,
    reason: "",
    auto_delete_state: "eligible"
  }
  return {
    candidate,
    deletesAt: Math.floor(now / 1000),
    exact: true,
    operation: event.type === "candidate.moved" ? "move" : "delete"
  }
}
