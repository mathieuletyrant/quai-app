import type { DayReleases, HomeOffline } from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { HomeReads } from "../home/HomeReads.ts"
import { QueuePage } from "../integrations/arr.ts"
import { RadarrCalendar, radarrCalendarPath, radarrCalendarQueuePath } from "../integrations/radarr.ts"
import { SonarrCalendar, sonarrCalendarPath, sonarrCalendarQueuePath } from "../integrations/sonarr.ts"
import { dayOf, dayRange } from "./Day.ts"
import { HomeTime } from "./HomeTime.ts"
import { dayReleases } from "./Tonight.ts"

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
      const reads = yield* HomeReads
      const time = yield* HomeTime

      return {
        today: Effect.gen(function*() {
          const zone = yield* time.zone
          const now = yield* Clock.currentTimeMillis
          const day = dayOf(now, zone)
          const { start, end } = dayRange(day, zone)
          const wide = 24 * 3600_000
          const { values, unavailable } = yield* reads.all({
            episodes: { service: "sonarr", path: sonarrCalendarPath(start, end), schema: SonarrCalendar },
            sonarrQueue: { service: "sonarr", path: sonarrCalendarQueuePath, schema: QueuePage },
            movies: { service: "radarr", path: radarrCalendarPath(start - wide, end + wide), schema: RadarrCalendar },
            radarrQueue: { service: "radarr", path: radarrCalendarQueuePath, schema: QueuePage }
          }, { optional: ["sonarrQueue", "radarrQueue"] })
          const { episodes, sonarrQueue, movies, radarrQueue } = values
          const items = dayReleases(day, zone, {
            episodes: Option.getOrUndefined(episodes),
            movies: Option.getOrUndefined(movies),
            sonarrQueue: Option.getOrUndefined(Option.map(sonarrQueue, (p) => p.records)),
            radarrQueue: Option.getOrUndefined(Option.map(radarrQueue, (p) => p.records))
          })
          return { day, timeZone: zone, items, unavailable }
        })
      }
    })
  )
}
