import { QuaiApi } from "@quai/api"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HomeRequiredLive } from "./home/HomeLink.ts"
import { AlertsHandlers, ConsoleAlertsHandlers } from "./http/AlertsHandlers.ts"
import { ConnectionHandlers } from "./http/ConnectionHandlers.ts"
import { ConsoleHandlers } from "./http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "./http/DeviceAuth.ts"
import { DevicesHandlers } from "./http/DevicesHandlers.ts"
import { FixesHandlers } from "./http/FixesHandlers.ts"
import { FlowsHandlers } from "./http/FlowsHandlers.ts"
import { AppJournalHandlers, JournalHandlers } from "./http/JournalHandlers.ts"
import { LibraryHandlers } from "./http/LibraryHandlers.ts"
import { PushHandlers } from "./http/PushHandlers.ts"
import { ReleasesHandlers } from "./http/ReleasesHandlers.ts"
import { UpcomingHandlers } from "./http/UpcomingHandlers.ts"
import { RequestsHandlers } from "./http/RequestsHandlers.ts"
import { SystemHandlers } from "./http/SystemHandlers.ts"

/** Every route of the contract, with its handlers. Needs the home link, the stores, the engine, the library, the To fix list, the requests, the journal and the public access. */
export const ApiLive = HttpApiBuilder.layer(QuaiApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, DevicesHandlers, LibraryHandlers, FixesHandlers, RequestsHandlers, ReleasesHandlers, UpcomingHandlers, ConsoleHandlers, ConnectionHandlers, PushHandlers, FlowsHandlers, JournalHandlers, AppJournalHandlers, AlertsHandlers, ConsoleAlertsHandlers]),
  Layer.provide([DeviceAuthLive, HomeRequiredLive])
)
