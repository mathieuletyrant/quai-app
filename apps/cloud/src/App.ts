import { Layer } from "effect"
import { ApiLive } from "./Api.ts"
import { Alerts } from "./alerts/Alerts.ts"
import { Fixes } from "./fixes/Fixes.ts"
import { ActionRunner } from "./flows/ActionRunner.ts"
import { Activities } from "./flows/Activities.ts"
import { FlowStore } from "./flows/FlowStore.ts"
import { TestRunner } from "./flows/TestRunner.ts"
import { ConsoleOnlyThroughHome, ConsoleRelayLive } from "./home/ConsoleRelay.ts"
import { Devices } from "./home/Devices.ts"
import { HomeLink } from "./home/HomeLink.ts"
import { HomeReads } from "./home/HomeReads.ts"
import { IntegrationsLive } from "./integrations/All.ts"
import { Hub } from "./integrations/Hub.ts"
import { Journal } from "./journal/Journal.ts"
import { Library } from "./library/Library.ts"
import { Notifier } from "./push/Notifier.ts"
import { HomeTime } from "./home/HomeTime.ts"
import { Requests } from "./requests/Requests.ts"
import { Upcoming } from "./upcoming/Upcoming.ts"

const HomeData = Layer.mergeAll(Devices.layer, FlowStore.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(HomeLink.documents, HomeReads.layer)),
  Layer.provideMerge(Journal.layer)
)

/**
 * One home's services, on its own link (`HomeLink`): its stores, its engine and Hub, its journal.
 * What all homes share comes from outside: the APNs key (`Apns`), the public access, the server's facts.
 */
export const HomeServices = Layer.mergeAll(ActionRunner.layer, Requests.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(Hub.layer, TestRunner.layer, Library.layer, Fixes.layer, Upcoming.layer)),
  Layer.provideMerge(Layer.mergeAll(Notifier.layer, Alerts.layer)),
  Layer.provideMerge(Activities.layer),
  Layer.provideMerge(Layer.mergeAll(IntegrationsLive, HomeTime.layer)),
  Layer.provideMerge(HomeData)
)

/** One home's routes: the whole API, and the console requests its Quai Home relays. */
export const HomeRoutes = Layer.mergeAll(ApiLive, ConsoleRelayLive).pipe(Layer.provideMerge(HomeServices))

/** One home's app, as `Homes` builds it for each home: its routes, the console only through Quai Home. */
export const HomeApp = Layer.mergeAll(HomeRoutes, ConsoleOnlyThroughHome)
