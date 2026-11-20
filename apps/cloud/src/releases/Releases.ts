import type { DayReleases, HomeOffline } from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { HomeReads } from "../home/HomeReads.ts"
import { dayOf } from "./Day.ts"
import { HomeTime } from "./HomeTime.ts"
import { dayInputs, dayReads, dayReleases } from "./Today.ts"

/**
 * Today's releases for the app's Today tile, read through Quai Home when it asks (nothing is
 * kept): the day's reads (`dayReads`), in the home's day.
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
          const day = dayOf(yield* Clock.currentTimeMillis, zone)
          const { values, unavailable } = yield* reads.all({ ...dayReads(day, zone) }, { optional: ["sonarrQueue", "radarrQueue"] })
          const items = dayReleases(day, zone, dayInputs({
            episodes: Option.getOrUndefined(values.episodes),
            movies: Option.getOrUndefined(values.movies),
            sonarrQueue: Option.getOrUndefined(values.sonarrQueue),
            radarrQueue: Option.getOrUndefined(values.radarrQueue)
          }))
          return { day, timeZone: zone, items, unavailable }
        })
      }
    })
  )
}
