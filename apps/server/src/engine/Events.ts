/**
 * What the adapters tell the engine, already normalized: the engine never sees a Radarr or
 * qBittorrent payload. `mediaKey` is `movie:tmdb:<id>` or `series:tvdb:<id>`.
 */
export type MediaEvent =
  | { readonly _tag: "Added"; readonly mediaKey: string; readonly title: string }
  | { readonly _tag: "Grabbed"; readonly mediaKey: string; readonly title: string; readonly downloadId: string }
  | {
    readonly _tag: "Progress"
    readonly downloadId: string
    readonly progress: number
    readonly bytesPerSecond: number
    readonly remainingSeconds: number | null
  }
  | { readonly _tag: "Imported"; readonly mediaKey: string; readonly title: string }
  | { readonly _tag: "Available"; readonly mediaKey: string }

export const movieKey = (tmdbId: number) => `movie:tmdb:${tmdbId}`
export const seriesKey = (tvdbId: number) => `series:tvdb:${tvdbId}`
