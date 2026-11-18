import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

export const Health = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
  uptimeSeconds: Schema.Number
})
export type Health = typeof Health.Type

export class SystemGroup extends HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("health", "/health", { success: Health }))
  .prefix("/api") {}
