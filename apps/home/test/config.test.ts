import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { HomeConfig } from "../src/Config.ts"

const configFrom = (env: Record<string, string>) =>
  Effect.service(HomeConfig).pipe(
    Effect.provide(HomeConfig.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { QUAI_CLOUD_URL: "ws://cloud/home", ...env } })))))
  )

describe("HomeConfig", () => {
  it.effect("where an iPhone opens Radarr and Sonarr: at home, then from outside, without a trailing slash", () =>
    Effect.gen(function*() {
      const config = yield* configFrom({
        QUAI_RADARR_WEB_URL: "http://umbrel.local:7878/",
        QUAI_RADARR_PUBLIC_URL: "https://radarr.example.com",
        QUAI_SONARR_PUBLIC_URL: "https://sonarr.example.com"
      })
      expect(config.webUrls).toEqual({
        radarr: ["http://umbrel.local:7878", "https://radarr.example.com"],
        sonarr: ["https://sonarr.example.com"]
      })
    }))

  it.effect("none set, or set empty (a settings form saved blank): no address", () =>
    Effect.gen(function*() {
      expect((yield* configFrom({})).webUrls).toEqual({})
      expect((yield* configFrom({ QUAI_RADARR_WEB_URL: "", QUAI_SONARR_PUBLIC_URL: "  " })).webUrls).toEqual({})
    }))
})
