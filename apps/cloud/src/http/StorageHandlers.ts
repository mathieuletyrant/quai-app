import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Storage } from "../storage/Storage.ts"

export const StorageHandlers = HttpApiBuilder.group(QuaiApi, "storage", (handlers) =>
  Effect.gen(function*() {
    const storage = yield* Storage
    return handlers.handle("storage", ({ query }) => storage.read(query.period ?? "30d"))
  }))
