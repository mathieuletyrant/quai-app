import { HttpApi } from "effect/http-api"
import { ConnectionGroup, ConsoleGroup, DevicesGroup, FlowsGroup, PushGroup } from "./Devices.ts"
import { ConsoleFixesGroup, FixesGroup } from "./Fixes.ts"
import { LibraryGroup } from "./Library.ts"
import { SystemGroup } from "./System.ts"

export * from "./Activity.ts"
export * as HomeProtocol from "./Home.ts"
export * from "./Devices.ts"
export * from "./Catalog.ts"
export * from "./Fixes.ts"
export * from "./Library.ts"
export * from "./System.ts"

/** The single contract: implemented by apps/cloud, imported by apps/console, exported as OpenAPI for apps/ios. */
export class QuaiApi extends HttpApi.make("quai").add(SystemGroup).add(DevicesGroup).add(LibraryGroup).add(FixesGroup).add(ConsoleGroup).add(ConsoleFixesGroup).add(PushGroup).add(ConnectionGroup).add(FlowsGroup) {}
