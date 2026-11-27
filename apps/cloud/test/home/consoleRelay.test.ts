import { describe, expect, it } from "@effect/vitest"
import { QuaiApi } from "@quai/api"
import { ConsoleOnlyThroughHome, ConsoleRelayLive } from "@quai/domain/home/ConsoleRelay.ts"
import { HomeLink } from "@quai/domain/home/HomeLink.ts"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { makeFakeHome } from "../fakeHome.ts"
import { TestApp } from "../testApp.ts"

/** The Cloud's routes on its public port, as main.ts serves them: the console only through Quai Home. */
const CloudServer = HttpRouter.serve(
  Layer.mergeAll(HttpApiBuilder.layer(QuaiApi), ConsoleRelayLive, ConsoleOnlyThroughHome)
).pipe(
  Layer.provideMerge(TestApp)
)

describe("console relay", () => {
  it.effect("answers the console's requests Quai Home relays, with the Cloud's own routes", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      expect(yield* home.console({ method: "GET", path: "/console-api/devices" })).toEqual({ status: 200, json: [] })
      const qr = yield* home.console({
        method: "POST",
        path: "/console-api/pairing-codes",
        body: JSON.stringify({ serverUrls: ["https://quai.example.com"] })
      })
      expect(qr.status).toBe(200)
      expect((qr.json as { link: string }).link).toContain("url=https%3A%2F%2Fquai.example.com")
      expect((yield* home.console({ method: "GET", path: "/api/health" })).status).toBe(200)
      // Only the console's routes: not the iPhone's, not a way around the path check.
      expect((yield* home.console({ method: "GET", path: "/api/activities" })).status).toBe(404)
      expect((yield* home.console({ method: "GET", path: "/console-api/../api/activities" })).status).toBe(404)
    }).pipe(Effect.provide(CloudServer)))

  it.effect("refuses /console-api on the public port: the console is Quai Home's", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome()
      yield* home.connect
      const client = yield* HttpClient.HttpClient
      expect((yield* client.get("/console-api/devices")).status).toBe(404)
      expect((yield* client.get("/api/health")).status).toBe(200)
    }).pipe(Effect.provide(CloudServer)))

  it.effect("follows the services Quai Home reaches, set from its console", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({ services: ["radarr"] })
      yield* home.connect
      yield* home.servicesChanged(["radarr", "sonarr"])
      const linked = yield* (yield* HomeLink).home
      expect(Option.map(linked, (linkedHome) => linkedHome.services)).toEqual(Option.some(["radarr", "sonarr"]))
    }).pipe(Effect.provide(TestApp)))
})
