import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Upcoming } from "../upcoming/Upcoming.ts"

export const UpcomingHandlers = HttpApiBuilder.group(QuaiApi, "upcoming", (handlers) =>
  Effect.gen(function*() {
    const upcoming = yield* Upcoming
    return handlers.handle("list", () => upcoming.list)
  }))
