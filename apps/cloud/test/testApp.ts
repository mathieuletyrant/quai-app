import { NodeHttpServer } from "@effect/platform-node"
import { Fixes } from "@quai/domain/fixes/Fixes.ts"
import { ActionRunner } from "@quai/domain/flows/ActionRunner.ts"
import { TestRunner } from "@quai/domain/flows/TestRunner.ts"
import { type HomeLink, HomeRequiredLive } from "@quai/domain/home/HomeLink.ts"
import { AlertsHandlers, ConsoleAlertsHandlers } from "@quai/domain/http/AlertsHandlers.ts"
import { ConnectionHandlers } from "@quai/domain/http/ConnectionHandlers.ts"
import { ConsoleHandlers } from "@quai/domain/http/ConsoleHandlers.ts"
import { DeviceAuthLive } from "@quai/domain/http/DeviceAuth.ts"
import { DevicesHandlers } from "@quai/domain/http/DevicesHandlers.ts"
import { FixesHandlers } from "@quai/domain/http/FixesHandlers.ts"
import { FlowsHandlers } from "@quai/domain/http/FlowsHandlers.ts"
import { AppJournalHandlers, JournalHandlers } from "@quai/domain/http/JournalHandlers.ts"
import { LibraryHandlers } from "@quai/domain/http/LibraryHandlers.ts"
import { PushHandlers } from "@quai/domain/http/PushHandlers.ts"
import { RequestsHandlers } from "@quai/domain/http/RequestsHandlers.ts"
import { StorageHandlers } from "@quai/domain/http/StorageHandlers.ts"
import { SystemHandlers } from "@quai/domain/http/SystemHandlers.ts"
import { UpcomingHandlers } from "@quai/domain/http/UpcomingHandlers.ts"
import { IntegrationsLive } from "@quai/domain/integrations/All.ts"
import { Seerr } from "@quai/domain/integrations/seerr.ts"
import { Library } from "@quai/domain/library/Library.ts"
import { PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Apns, type ApnsRequest } from "@quai/domain/push/Apns.ts"
import { Requests } from "@quai/domain/requests/Requests.ts"
import { Storage } from "@quai/domain/storage/Storage.ts"
import { Upcoming } from "@quai/domain/upcoming/Upcoming.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Effect, Layer, Option } from "effect"
import { HttpApiError } from "effect/http-api"
import { makeApns } from "../src/push/ApnsClient.ts"
import { cloud, type FakeLinks, linkDroppingOn, makeFakeHome, testLink } from "./fakeHome.ts"

/** Everything the domain's routes need, on a fake Quai Home and an in-memory HTTP server. No APNs key. */
export const testAppWith = <E>(
  publicAccess: Layer.Layer<PublicAccess, E>,
  link: Layer.Layer<HomeLink | FakeLinks> = testLink,
  apns: Layer.Layer<Apns> = Layer.effect(Apns, makeApns(null))
) =>
  Layer.mergeAll(
    SystemHandlers,
    DevicesHandlers,
    LibraryHandlers,
    StorageHandlers,
    FixesHandlers,
    RequestsHandlers,
    UpcomingHandlers,
    ConsoleHandlers,
    ConnectionHandlers,
    PushHandlers,
    FlowsHandlers,
    JournalHandlers,
    AppJournalHandlers,
    AlertsHandlers,
    ConsoleAlertsHandlers
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(DeviceAuthLive, HomeRequiredLive)),
    Layer.provideMerge(
      Layer.mergeAll(
        TestRunner.layer,
        Library.layer,
        Storage.layer,
        Fixes.layer,
        Requests.layer.pipe(Layer.provide(Seerr.layer)),
        Upcoming.layer
      )
    ),
    // Actions have their own tests (flows/actions.test.ts); the routes here don't need Jellyfin.
    Layer.provideMerge(Layer.succeed(ActionRunner, { run: () => Effect.fail(new HttpApiError.NotFound()) })),
    Layer.provideMerge(cloud(IntegrationsLive, link)),
    Layer.provideMerge(apns),
    Layer.provideMerge(publicAccess),
    Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
    Layer.provideMerge(NodeHttpServer.layerTest)
  )

const noPublicAccess = Layer.succeed(PublicAccess, PublicAccess.make(Option.none(), []))

/** The routes with no public address and no access headers. */
export const TestApp = testAppWith(noPublicAccess)

/** The routes, on a link that finds Quai Home gone for these calls (`linkDroppingOn`). */
export const testAppDroppingOn = (...routes: ReadonlyArray<string>) =>
  testAppWith(noPublicAccess, linkDroppingOn(...routes))

/** The routes, with an APNs key whose pushes land in `sent` instead of Apple. */
export const testAppPushingTo = (sent: Array<ApnsRequest>) =>
  testAppWith(
    noPublicAccess,
    testLink,
    Layer.succeed(Apns, {
      configured: Effect.succeed(true),
      settings: { configured: true, topic: "com.mathieuletyrant.quai" },
      send: (request) => Effect.sync(() => void sent.push(request))
    })
  )

/** A fake Quai Home, connected. */
export const connectedHome = Effect.tap(makeFakeHome(), (home) => home.connect)
