import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Library } from "../library/Library.ts"

export const LibraryHandlers = HttpApiBuilder.group(QuaiApi, "library", (handlers) =>
  Effect.gen(function*() {
    const library = yield* Library
    return handlers.handle("library", () => library.list)
  }))
