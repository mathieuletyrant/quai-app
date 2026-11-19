import { type DiskSpace, type Flow, HomeOffline, type Library as LibraryList, type LibraryItem } from "@quai/api"
import { Context, Effect, Layer, Option, type Schema } from "effect"
import { Activities } from "../flows/Activities.ts"
import type { Activity } from "../flows/Engine.ts"
import { movieKey, seriesKey } from "../flows/Events.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { readJson } from "../integrations/Integration.ts"
import { DiskSpaces, libraryMovie, mediaDisk, RadarrMovies } from "../integrations/radarr.ts"
import { librarySeries, SonarrSeries } from "../integrations/sonarr.ts"

type Service = "radarr" | "sonarr"

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
      const link = yield* HomeLink
      const activities = yield* Activities
      const flowStore = yield* FlowStore

      /** The body of a GET, or None when the service didn't answer it. */
      const read = <A, I>(service: Service, path: string, schema: Schema.Codec<A, I>) =>
        link.call({ service, method: "GET", path }).pipe(
          Effect.map((r) => r.status === 200 ? readJson(schema, r.body) : Option.none()),
          Effect.tap((body) => Option.isNone(body) ? Effect.logWarning(`library: could not read ${service} ${path}`) : Effect.void),
          Effect.catchTag("HomeError", (error) =>
            Effect.as(Effect.logWarning(`library: ${service} ${path}: ${error.message}`), Option.none<A>()))
        )

      const list = Effect.gen(function*() {
        const home = yield* link.home
        if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
        const reaches = (service: Service) => home.value.services.includes(service)

        const none = Effect.succeed(Option.none())
        const [movies, series, radarrDisk] = yield* Effect.all([
          reaches("radarr") ? read("radarr", "/api/v3/movie", RadarrMovies) : none,
          reaches("sonarr") ? read("sonarr", "/api/v3/series", SonarrSeries) : none,
          reaches("radarr") ? read("radarr", "/api/v3/diskspace", DiskSpaces) : none
        ], { concurrency: "unbounded" })
        const disks = Option.isNone(radarrDisk) && reaches("sonarr")
          ? yield* read("sonarr", "/api/v3/diskspace", DiskSpaces)
          : radarrDisk

        const flows = yield* flowStore.all
        const running = [...(yield* activities.snapshot).activities.values()].filter((a) => a.endedAt === null)
        const progress = downloadsOf(running, flows)
        const withDownload = (key: string, item: LibraryItem) => progress.has(key) ? downloading(item, progress.get(key)) : item

        const items = [
          ...Option.getOrElse(movies, () => []).map((m) => withDownload(movieKey(m.tmdbId), libraryMovie(m))),
          ...Option.getOrElse(series, () => []).map((s) => withDownload(seriesKey(s.tvdbId), librarySeries(s)))
        ].sort(newestFirst)
        const disk: DiskSpace | undefined = Option.getOrUndefined(Option.flatMap(disks, (d) => Option.fromNullishOr(mediaDisk(d))))
        const unavailable: Array<Service> = []
        if (reaches("radarr") && Option.isNone(movies)) unavailable.push("radarr")
        if (reaches("sonarr") && Option.isNone(series)) unavailable.push("sonarr")
        return { items, ...(disk === undefined ? {} : { disk }), unavailable }
      })

      return { list }
    })
  )
}
