/** What to look for in Jellyfin to call a download available. */
export type AvailabilityCheck =
  | { readonly _tag: "Movie"; readonly mediaKey: string; readonly tmdbId: number; readonly title: string }
  | {
    readonly _tag: "Episodes"
    readonly mediaKey: string
    readonly tvdbId: number
    readonly title: string
    readonly episodes: ReadonlyArray<{ readonly season: number; readonly episode: number }>
  }
