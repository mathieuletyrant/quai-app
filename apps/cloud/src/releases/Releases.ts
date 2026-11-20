import { type DayReleases, HomeOffline } from "@quai/api"
import { Clock, Context, Effect, Layer, Option, type Schema } from "effect"
import { HomeLink, offlineMessage } from "../home/HomeLink.ts"
import { QueuePage } from "../integrations/arr.ts"
import { readJson } from "../integrations/Integration.ts"
import { RadarrCalendar, radarrCalendarPath, radarrCalendarQueuePath } from "../integrations/radarr.ts"
import { SonarrCalendar, sonarrCalendarPath, sonarrCalendarQueuePath } from "../integrations/sonarr.ts"
import { dayOf, dayRange } from "./Day.ts"
import { HomeTime } from "./HomeTime.ts"
import { dayReleases } from "./Tonight.ts"

type Service = "radarr" | "sonarr"

/**
 * Today's releases for the app's Tonight tile, read through Quai Home when it asks (nothing is
 * kept): Sonarr's and Radarr's calendars and queues, in the home's day.
 */
export class Releases extends Context.Service<Releases, {
  readonly today: Effect.Effect<DayReleases, HomeOffline>
}>()("quai/Releases") {
  static readonly layer = Layer.effect(
    Releases,
    Effect.gen(function*() {
      const link = yield* HomeLink
      const time = yield* HomeTime

      const read = <A, I>(service: Service, path: string, schema: Schema.Codec<A, I>) =>
        link.call({ service, method: "GET", path }).pipe(
          Effect.map((r) => r.status === 200 ? readJson(schema, r.body) : Option.none()),
          Effect.catchTag("HomeError", (error) =>
            Effect.as(Effect.logWarning(`releases: ${service} ${path.split("?")[0]}: ${error.message}`), Option.none<A>()))
        )

      return {
        today: Effect.gen(function*() {
          const home = yield* link.home
          if (Option.isNone(home)) return yield* Effect.fail(new HomeOffline({ message: offlineMessage }))
          const reaches = (service: Service) => home.value.services.includes(service)
          const zone = yield* time.zone
          const now = yield* Clock.currentTimeMillis
          const day = dayOf(now, zone)
          const { start, end } = dayRange(day, zone)
          const wide = 24 * 3600_000
          const none = Effect.succeed(Option.none())
          const [episodes, sonarrQueue, movies, radarrQueue] = yield* Effect.all([
            reaches("sonarr") ? read("sonarr", sonarrCalendarPath(start, end), SonarrCalendar) : none,
            reaches("sonarr") ? read("sonarr", sonarrCalendarQueuePath, QueuePage) : none,
            reaches("radarr") ? read("radarr", radarrCalendarPath(start - wide, end + wide), RadarrCalendar) : none,
            reaches("radarr") ? read("radarr", radarrCalendarQueuePath, QueuePage) : none
          ], { concurrency: "unbounded" })
          const items = dayReleases(day, zone, {
            episodes: Option.getOrUndefined(episodes),
            movies: Option.getOrUndefined(movies),
            sonarrQueue: Option.getOrUndefined(Option.map(sonarrQueue, (p) => p.records)),
            radarrQueue: Option.getOrUndefined(Option.map(radarrQueue, (p) => p.records))
          })
          const unavailable: Array<Service> = []
          if (reaches("sonarr") && Option.isNone(episodes)) unavailable.push("sonarr")
          if (reaches("radarr") && Option.isNone(movies)) unavailable.push("radarr")
          return { day, timeZone: zone, items, unavailable }
        })
      }
    })
  )
}
