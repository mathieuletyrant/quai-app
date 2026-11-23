import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { cloudAppUrl, HomeConfig } from "../src/Config.ts"

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

  it.effect("where the iPhone reaches the Cloud: QUAI_CLOUD_APP_URL when the link's address is one only Quai Home reaches", () =>
    Effect.gen(function*() {
      expect(cloudAppUrl(yield* configFrom({ QUAI_CLOUD_URL: "wss://cloud.example.com/home" }))).toBe("https://cloud.example.com")
      expect(cloudAppUrl(yield* configFrom({ QUAI_CLOUD_URL: "ws://quai:8787/home", QUAI_CLOUD_APP_URL: "http://umbrel.local:3078/" }))).toBe("http://umbrel.local:3078")
      expect(cloudAppUrl(yield* configFrom({ QUAI_CLOUD_URL: "" }))).toBeNull()
    }))
})
