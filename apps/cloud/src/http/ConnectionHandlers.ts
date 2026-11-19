import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { PublicAccess } from "../PublicAccess.ts"

export const ConnectionHandlers = HttpApiBuilder.group(QuaiApi, "connection", (handlers) =>
  Effect.gen(function*() {
    const publicAccess = yield* PublicAccess
    return handlers.handle("connectionSettings", () => Effect.succeed(publicAccess.settings))
  }))
