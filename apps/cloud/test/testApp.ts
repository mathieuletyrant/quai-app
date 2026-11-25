import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { ActionRunner } from "../src/flows/ActionRunner.ts"
import { TestRunner } from "../src/flows/TestRunner.ts"
import { type HomeLink, type HomeLinks, HomeRequiredLive } from "../src/home/HomeLink.ts"
import { IntegrationsLive } from "../src/integrations/All.ts"
import { ConnectionHandlers } from "../src/http/ConnectionHandlers.ts"
import { ConsoleHandlers } from "../src/http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "../src/http/DeviceAuth.ts"
import { DevicesHandlers } from "../src/http/DevicesHandlers.ts"
import { FixesHandlers } from "../src/http/FixesHandlers.ts"
import { FlowsHandlers } from "../src/http/FlowsHandlers.ts"
import { AlertsHandlers, ConsoleAlertsHandlers } from "../src/http/AlertsHandlers.ts"
import { AppJournalHandlers, JournalHandlers } from "../src/http/JournalHandlers.ts"
import { LibraryHandlers } from "../src/http/LibraryHandlers.ts"
import { PushHandlers } from "../src/http/PushHandlers.ts"
import { ReleasesHandlers } from "../src/http/ReleasesHandlers.ts"
import { RequestsHandlers } from "../src/http/RequestsHandlers.ts"
import { UpcomingHandlers } from "../src/http/UpcomingHandlers.ts"
import { Upcoming } from "../src/upcoming/Upcoming.ts"
import { Requests } from "../src/requests/Requests.ts"
import { Seerr } from "../src/integrations/seerr.ts"
import { Releases } from "../src/releases/Releases.ts"
import { SystemHandlers } from "../src/http/SystemHandlers.ts"
import { Apns } from "../src/push/Apns.ts"
import { Fixes } from "../src/fixes/Fixes.ts"
import { Library } from "../src/library/Library.ts"
import { PublicAccess } from "../src/PublicAccess.ts"
import { ServerInfo } from "../src/Version.ts"
import { cloud, linkDroppingOn, makeFakeHome, testLink } from "./fakeHome.ts"

/** Everything the routes need, on a fake Quai Home and an in-memory HTTP server. No APNs key. */
export const testAppWith = <E>(publicAccess: Layer.Layer<PublicAccess, E>, link: Layer.Layer<HomeLink | HomeLinks> = testLink) => Layer.mergeAll(SystemHandlers, DevicesHandlers, LibraryHandlers, FixesHandlers, RequestsHandlers, ReleasesHandlers, UpcomingHandlers, ConsoleHandlers, ConnectionHandlers, PushHandlers, FlowsHandlers, JournalHandlers, AppJournalHandlers, AlertsHandlers, ConsoleAlertsHandlers).pipe(
  Layer.provideMerge(Layer.mergeAll(DeviceAuthLive, HomeRequiredLive)),
  Layer.provideMerge(Layer.mergeAll(TestRunner.layer, Library.layer, Fixes.layer, Requests.layer.pipe(Layer.provide(Seerr.layer)), Releases.layer, Upcoming.layer)),
  // Actions have their own tests (flows/actions.test.ts); the routes here don't need Jellyfin.
  Layer.provideMerge(Layer.succeed(ActionRunner, { run: () => Effect.fail(new HttpApiError.NotFound()) })),
  Layer.provideMerge(cloud(IntegrationsLive, link)),
  Layer.provideMerge(Layer.effect(Apns, Apns.make(null))),
  Layer.provideMerge(publicAccess),
  Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
  Layer.provideMerge(NodeHttpServer.layerTest)
)

const noPublicAccess = Layer.succeed(PublicAccess, PublicAccess.make(Option.none(), []))

/** The routes with no public address and no access headers. */
export const TestApp = testAppWith(noPublicAccess)

/** The routes, on a link that finds Quai Home gone for these calls (`linkDroppingOn`). */
export const testAppDroppingOn = (...routes: ReadonlyArray<string>) => testAppWith(noPublicAccess, linkDroppingOn(...routes))

/** A fake Quai Home, connected. */
export const connectedHome = Effect.tap(makeFakeHome(), (home) => home.connect)
