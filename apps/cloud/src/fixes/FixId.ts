import type { FixService } from "@quai/api"

/**
 * How a fix id is written, and read back: the only code that knows. A fix id names its problem
 * (`blocked-radarr-41`, `missing-movie-48`, `missing-season-3-2`, `deletion-42`,
 * `removal-0195f0e2-7c1a-7d3e-9a10-2f5e8b3c4d01`), stays the same
 * while the problem lasts (what the user hid is kept under it) and tells which service to read
 * again to act on it.
 */

/** What a fix id names. */
export type FixRef =
  | { readonly _tag: "Blocked"; readonly service: "radarr" | "sonarr"; readonly queueId: number }
  | { readonly _tag: "MissingMovie"; readonly movieId: number }
  | { readonly _tag: "MissingSeason"; readonly seriesId: number; readonly seasonNumber: number }
  | { readonly _tag: "Deletion"; readonly candidateId: number }
  | { readonly _tag: "Removal"; readonly downloadItemId: string }

/** A finished download the *arr won't import: its queue row. */
export const blocked = (service: "radarr" | "sonarr", queueId: number) => `blocked-${service}-${queueId}`

/** A movie without a source. */
export const missingMovie = (movieId: number) => `missing-movie-${movieId}`

/** A season's episodes without a source. */
export const missingSeason = (seriesId: number, seasonNumber: number) => `missing-season-${seriesId}-${seasonNumber}`

/** A title Reclaimerr is going to delete. */
export const deletion = (candidateId: number) => `deletion-${candidateId}`

/**
 * A download Cleanuparr is going to remove, by Cleanuparr's id of it (a UUID, lowercase): stable
 * while it is struck, and fit for a home document's key, which a download id isn't always.
 */
export const removal = (downloadItemId: string) => `removal-${downloadItemId.toLowerCase()}`

/** What an id names; undefined for an id Quai never made. */
export const parse = (id: string): FixRef | undefined => {
  const blockedId = /^blocked-(radarr|sonarr)-(\d+)$/.exec(id)
  if (blockedId !== null) return { _tag: "Blocked", service: blockedId[1] as "radarr" | "sonarr", queueId: Number(blockedId[2]) }
  const movie = /^missing-movie-(\d+)$/.exec(id)
  if (movie !== null) return { _tag: "MissingMovie", movieId: Number(movie[1]) }
  const season = /^missing-season-(\d+)-(\d+)$/.exec(id)
  if (season !== null) return { _tag: "MissingSeason", seriesId: Number(season[1]), seasonNumber: Number(season[2]) }
  const candidate = /^deletion-(\d+)$/.exec(id)
  if (candidate !== null) return { _tag: "Deletion", candidateId: Number(candidate[1]) }
  const removed = /^removal-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(id)
  return removed === null ? undefined : { _tag: "Removal", downloadItemId: removed[1]! }
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
    case "Removal":
      return "cleanuparr"
  }
}
