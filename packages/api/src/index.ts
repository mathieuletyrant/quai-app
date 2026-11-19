import { HttpApi } from "effect/http-api"
import { ConsoleGroup, DevicesGroup, FlowsGroup, PushGroup } from "./Devices.ts"
import { SystemGroup } from "./System.ts"

export * from "./Activity.ts"
export * as HomeProtocol from "./Home.ts"
export * from "./Devices.ts"
export * from "./Catalog.ts"
export * from "./System.ts"

/** The single contract: implemented by apps/cloud, imported by apps/console, exported as OpenAPI for apps/ios. */
export class QuaiApi extends HttpApi.make("quai").add(SystemGroup).add(DevicesGroup).add(ConsoleGroup).add(PushGroup).add(FlowsGroup) {}
