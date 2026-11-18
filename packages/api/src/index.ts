import { HttpApi } from "effect/http-api"
import { ConsoleGroup, DevicesGroup } from "./Devices.ts"
import { SystemGroup } from "./System.ts"

export * from "./Activity.ts"
export * from "./Devices.ts"
export * from "./Download.ts"
export * from "./System.ts"

/** The single contract: implemented by apps/server, imported by apps/console, exported as OpenAPI for apps/ios. */
export class QuaiApi extends HttpApi.make("quai").add(SystemGroup).add(DevicesGroup).add(ConsoleGroup) {}
