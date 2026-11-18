import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** Typed client derived from the contract: changing a route in packages/api breaks compilation here. */
const client = HttpApiClient.make(QuaiApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

type Client = Effect.Success<typeof client>

/** Runs one call at the React boundary. */
export const call = <A, E>(f: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(client, f))
