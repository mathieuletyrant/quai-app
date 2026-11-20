import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Search } from "../search/Search.ts"

/** The app's search: `/api/search`, behind the iPhone's token. */
export const SearchHandlers = HttpApiBuilder.group(QuaiApi, "search", (handlers) =>
  Effect.gen(function*() {
    const search = yield* Search
    return handlers.handle("search", ({ query }) => search.search(query.q))
  }))
