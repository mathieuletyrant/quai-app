import type { FixService } from "@quai/api"

/**
 * How a fix id is written, and read back: the only code that knows. A fix id names its problem
 * (`blocked-radarr-41`, `missing-movie-48`, `missing-season-3-2`, `deletion-42`), stays the same
 * while the problem lasts (what the user hid is kept under it) and tells which service to read
 * again to act on it.
 */

/** What a fix id names. */
export type FixRef =
  | { readonly _tag: "Blocked"; readonly service: "radarr" | "sonarr"; readonly queueId: number }
  | { readonly _tag: "MissingMovie"; readonly movieId: number }
  | { readonly _tag: "MissingSeason"; readonly seriesId: number; readonly seasonNumber: number }
  | { readonly _tag: "Deletion"; readonly candidateId: number }

/** A finished download the *arr won't import: its queue row. */
export const blocked = (service: "radarr" | "sonarr", queueId: number) => `blocked-${service}-${queueId}`

/** A movie without a source. */
export const missingMovie = (movieId: number) => `missing-movie-${movieId}`

/** A season's episodes without a source. */
export const missingSeason = (seriesId: number, seasonNumber: number) => `missing-season-${seriesId}-${seasonNumber}`

/** A title Reclaimerr is going to delete. */
export const deletion = (candidateId: number) => `deletion-${candidateId}`

/** What an id names; undefined for an id Quai never made. */
export const parse = (id: string): FixRef | undefined => {
  const blockedId = /^blocked-(radarr|sonarr)-(\d+)$/.exec(id)
  if (blockedId !== null) return { _tag: "Blocked", service: blockedId[1] as "radarr" | "sonarr", queueId: Number(blockedId[2]) }
  const movie = /^missing-movie-(\d+)$/.exec(id)
  if (movie !== null) return { _tag: "MissingMovie", movieId: Number(movie[1]) }
  const season = /^missing-season-(\d+)-(\d+)$/.exec(id)
  if (season !== null) return { _tag: "MissingSeason", seriesId: Number(season[1]), seasonNumber: Number(season[2]) }
  const candidate = /^deletion-(\d+)$/.exec(id)
  return candidate === null ? undefined : { _tag: "Deletion", candidateId: Number(candidate[1]) }
}

/** The service a fix id belongs to, so acting on one reads only that service again. */
export const serviceOf = (id: string): FixService | undefined => {
  const ref = parse(id)
  switch (ref?._tag) {
    case undefined:
      return undefined
    case "Blocked":
      return ref.service
    case "MissingMovie":
      return "radarr"
    case "MissingSeason":
      return "sonarr"
    case "Deletion":
      return "reclaimerr"
  }
}
