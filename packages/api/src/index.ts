import { HttpApi } from "effect/http-api"
import { SystemGroup } from "./System.ts"

export * from "./Activity.ts"
export * from "./System.ts"

/** The single contract: implemented by apps/server, imported by apps/console, exported as OpenAPI for apps/ios. */
export class QuaiApi extends HttpApi.make("quai").add(SystemGroup) {}
