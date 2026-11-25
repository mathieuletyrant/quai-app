import type { TitleKind } from "@quai/api"

/**
 * A library title's id: `movie:<radarr id>`, `series:<sonarr id>`, a season `series:<id>:s<n>`. The
 * app gets it (`LibraryItem.id`, an Upcoming row's `libraryId`) and sends it back, so it is made and
 * read here only, and its format never changes.
 */
export type LibraryId = string

export const movie = (radarrId: number): LibraryId => `movie:${radarrId}`

export const series = (sonarrId: number): LibraryId => `series:${sonarrId}`

export const season = (sonarrId: number, seasonNumber: number): LibraryId => `series:${sonarrId}:s${seasonNumber}`

export interface Parsed {
  readonly kind: TitleKind
  /** Radarr's or Sonarr's id. */
  readonly id: number
  readonly season?: number
}

const pattern = /^(movie|series):(\d+)(?::s(\d+))?$/

/** None for anything else. */
export const parse = (libraryId: LibraryId): Parsed | undefined => {
  const match = pattern.exec(libraryId)
  if (match === null || (match[1] === "movie" && match[3] !== undefined)) return undefined
  return { kind: match[1] as TitleKind, id: Number(match[2]), ...(match[3] === undefined ? {} : { season: Number(match[3]) }) }
}

/** The whole title a season belongs to: `series:5:s2` → `series:5`. */
export const titleOf = (libraryId: LibraryId): LibraryId => {
  const parsed = parse(libraryId)
  if (parsed === undefined) return libraryId
  return parsed.kind === "movie" ? movie(parsed.id) : series(parsed.id)
}
