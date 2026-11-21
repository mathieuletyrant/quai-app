import { type DiskSpace, type Flow, type HomeOffline, type Library as LibraryList, type LibraryItem } from "@quai/api"
import { Context, Effect, Layer, Option } from "effect"
import { Activities } from "../flows/Activities.ts"
import type { Activity } from "../flows/Engine.ts"
import { movieKey, seriesKey } from "../flows/Events.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { DiskSpaces, libraryMovie, mediaDisk, RadarrMovies } from "../integrations/radarr.ts"
import { librarySeries, SonarrSeries } from "../integrations/sonarr.ts"

/** A torrent of this title is being downloaded: its activity sits on the step a grab enters. */
const downloadsOf = (running: ReadonlyArray<Activity>, flows: ReadonlyArray<Flow>) => {
  const progress = new Map<string, number | undefined>()
  for (const activity of running) {
    const flow = flows.find((f) => f.id === activity.flowId)
    if (flow?.steps[activity.stepIndex]?.on !== "media.grabbed") continue
    // Series activities are one per torrent (`series:tvdb:1:dl:<hash>`): the series is the prefix.
    const subject = activity.subjectKey.split(":dl:")[0]!
    const known = progress.get(subject)
    progress.set(subject, known ?? activity.values.progress)
  }
  return progress
}

const downloading = (item: LibraryItem, progress: number | undefined): LibraryItem => ({
  ...item,
  status: "downloading",
  ...(progress === undefined ? {} : { progress })
})

const newestFirst = (a: LibraryItem, b: LibraryItem) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || a.title.localeCompare(b.title)

/**
 * The home's movies and series, read through Quai Home when the app asks (nothing is kept): one
 * call to Radarr, one to Sonarr, one for the disk. A service that doesn't answer is listed as
 * unavailable, the others still show. What downloads now comes from the running activities.
 */
export class Library extends Context.Service<Library, {
  readonly list: Effect.Effect<LibraryList, HomeOffline>
}>()("quai/Library") {
  static readonly layer = Layer.effect(
    Library,
    Effect.gen(function*() {
      const reads = yield* HomeReads
      const activities = yield* Activities
      const flowStore = yield* FlowStore

      const list = Effect.gen(function*() {
        const { values, unavailable } = yield* reads.all({
          movies: { service: "radarr", path: "/api/v3/movie", schema: RadarrMovies },
          series: { service: "sonarr", path: "/api/v3/series", schema: SonarrSeries },
          radarrDisk: { service: "radarr", path: "/api/v3/diskspace", schema: DiskSpaces }
        }, { optional: ["radarrDisk"] })
        const { movies, series, radarrDisk } = values
        const disks = Option.isNone(radarrDisk) && (yield* reads.services).includes("sonarr")
          ? yield* reads.read({ service: "sonarr", path: "/api/v3/diskspace", schema: DiskSpaces })
          : radarrDisk

        const webUrls = yield* reads.webUrls
        const flows = yield* flowStore.all
        const running = [...(yield* activities.snapshot).activities.values()].filter((a) => a.endedAt === null)
        const progress = downloadsOf(running, flows)
        const withDownload = (key: string, item: LibraryItem) => progress.has(key) ? downloading(item, progress.get(key)) : item

        const items = [
          ...Option.getOrElse(movies, () => []).map((m) => withDownload(movieKey(m.tmdbId), libraryMovie(m, webUrls.radarr))),
          ...Option.getOrElse(series, () => []).map((s) => withDownload(seriesKey(s.tvdbId), librarySeries(s, webUrls.sonarr)))
        ].sort(newestFirst)
        const disk: DiskSpace | undefined = Option.getOrUndefined(Option.flatMap(disks, (d) => Option.fromNullishOr(mediaDisk(d))))
        return { items, ...(disk === undefined ? {} : { disk }), unavailable }
      })

      return { list }
    })
  )
}
