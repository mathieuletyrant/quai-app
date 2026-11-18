import { HttpApi } from "effect/http-api"
import { SystemGroup } from "./System.ts"

export * from "./Activity.ts"
export * from "./System.ts"

/** Contrat unique : implémenté par apps/server, importé par apps/console, exporté en OpenAPI pour apps/ios. */
export class QuaiApi extends HttpApi.make("quai").add(SystemGroup) {}
