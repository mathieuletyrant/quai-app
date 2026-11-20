import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Releases } from "../releases/Releases.ts"

export const ReleasesHandlers = HttpApiBuilder.group(QuaiApi, "releases", (handlers) =>
  Effect.gen(function*() {
    const releases = yield* Releases
    return handlers.handle("today", () => releases.today)
  }))
