import { describe, expect, it } from "@effect/vitest"
import { DeviceAuth, QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { makeFakeHome, recordedHome } from "./fakeHome.ts"
import { previewRoutes } from "./previewHome.ts"
import { TestApp } from "./testApp.ts"

const demoFixtures = fileURLToPath(new URL("./fixtures/demo", import.meta.url))

const files = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
  )

/** The demo home (GLOSSARY): what App Review sees, without a stack. */
describe("the demo home", () => {
  it("shows no image but the open movies' posters on quai.stream", () => {
    const urls = files(demoFixtures).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/https?:\/\/[^"]+\.(?:jpe?g|png|webp)/gi)].map((match) => match[0])
    )
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((url) => !url.startsWith("https://quai.stream/posters/"))).toEqual([])
  })

  it("names nobody real: the users are Sam and Alex", () => {
    const people = files(demoFixtures).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/"(?:displayName|jellyfinUsername|email)": "([^"]+)"/g)].map((match) =>
        match[1]
      )
    )
    expect(new Set(people)).toEqual(new Set(["Sam", "sam", "Alex", "alex", "admin@example.com", "alex@example.com"]))
  })

  // The demo fixtures go through the real adapters: when a service's API moves, this fails with the tests.
  it.effect("fills the app's screens, every service read", () =>
    Effect.gen(function*() {
      const home = yield* makeFakeHome({
        strict: false,
        services: ["radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "reclaimerr", "cleanuparr"],
        answer: recordedHome(previewRoutes(0))
      })
      yield* home.connect
      const qr = yield* (yield* HttpApiTest.groups(QuaiApi, ["console"])).console.createPairingCode({
        payload: { serverUrls: [] }
      })
      const { token } = yield* (yield* HttpApiTest.groups(QuaiApi, ["devices"])).devices.pair({
        payload: { name: "App Review", apnsEnvironment: "production", code: qr.code }
      })
      const api = yield* HttpApiTest.groups(QuaiApi, ["library", "upcoming", "fixes", "requests", "storage"]).pipe(
        Effect.provide(HttpApiMiddleware.layerClient(DeviceAuth, ({ request, next }) =>
          next(HttpClientRequest.bearerToken(request, token))))
      )
      const library = yield* api.library.library()
      expect([library.items.length > 0, library.unavailable]).toEqual([true, []])
      const upcoming = yield* api.upcoming.list()
      expect(upcoming.unavailable).toEqual([])
      const fixes = yield* api.fixes.list()
      expect([fixes.items.length > 0, fixes.unavailable]).toEqual([true, []])
      const requests = yield* api.requests.list()
      expect([requests.items.length > 0, requests.status]).toEqual([true, "ok"])
      const storage = yield* api.storage.storage({ query: {} })
      expect([storage.disks.length, storage.unavailable]).toEqual([1, []])
    }).pipe(Effect.provide(TestApp)))
})
