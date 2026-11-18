import { QuaiApi } from "@quai/api"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SystemHandlers } from "./SystemHandlers.ts"

/** Toutes les routes du contrat, avec leurs handlers. */
export const ApiLive = HttpApiBuilder.layer(QuaiApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(SystemHandlers)
)
