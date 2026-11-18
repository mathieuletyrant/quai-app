import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** Typed client derived from the contract: changing a route in packages/api breaks compilation here. */
export const quaiClient = HttpApiClient.make(QuaiApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

export const fetchHealth = () =>
  Effect.runPromise(Effect.flatMap(quaiClient, (client) => client.system.health()))
