import { Config, Context, Effect, Layer, Option } from "effect"
import { Devices } from "./Devices.ts"
import { isTimeZone } from "./Day.ts"

/**
 * The home's time zone, for "today" and "midnight". A home has no clock of its own: it follows
 * the iPhones, which report theirs (the most recently seen one wins). Before any did, Quai Cloud's
 * `QUAI_TZ`, else UTC.
 */
export class HomeTime extends Context.Service<HomeTime, {
  readonly zone: Effect.Effect<string>
}>()("quai/HomeTime") {
  static readonly make = (fallback: string) =>
    Effect.gen(function*() {
      const devices = yield* Devices
      return {
        zone: devices.timeZone.pipe(
          Effect.map(Option.getOrElse(() => fallback)),
          Effect.orElseSucceed(() => fallback)
        )
      }
    })

  static readonly layer = Layer.effect(
    HomeTime,
    Effect.gen(function*() {
      const configured = yield* Config.option(Config.String("QUAI_TZ"))
      const fallback = Option.match(configured, { onNone: () => "UTC", onSome: (zone) => isTimeZone(zone) ? zone : "UTC" })
      return yield* HomeTime.make(fallback)
    })
  )
}
