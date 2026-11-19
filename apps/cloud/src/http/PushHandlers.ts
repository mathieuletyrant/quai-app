import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Apns } from "../push/Apns.ts"

export const PushHandlers = HttpApiBuilder.group(QuaiApi, "push", (handlers) =>
  Effect.gen(function*() {
    const apns = yield* Apns
    return handlers.handle("pushSettings", () => Effect.succeed(apns.settings))
  }))
