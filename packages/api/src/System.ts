import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

export const Health = Schema.Struct({
  status: Schema.Literal("ok"),
  version: Schema.String,
  uptimeSeconds: Schema.Finite
}).annotate({ identifier: "Health" })
export type Health = typeof Health.Type

export class SystemGroup extends HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("health", "/health", { success: Health }).annotate(OpenApi.Identifier, "getHealth"))
  .prefix("/api")
{}
