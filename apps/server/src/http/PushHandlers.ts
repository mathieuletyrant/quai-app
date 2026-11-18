import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { PushKey } from "../store/PushKey.ts"

export const PushHandlers = HttpApiBuilder.group(QuaiApi, "push", (handlers) =>
  Effect.gen(function*() {
    const pushKey = yield* PushKey
    return handlers
      .handle("pushSettings", () => pushKey.settings)
      .handle("savePushKey", ({ payload }) => pushKey.save(payload))
      .handle("removePushKey", () => pushKey.remove)
  }))
