import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** Client typé dérivé du contrat : une route modifiée dans packages/api casse la compilation ici. */
export const quaiClient = HttpApiClient.make(QuaiApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

export const fetchHealth = () =>
  Effect.runPromise(Effect.flatMap(quaiClient, (client) => client.system.health()))
