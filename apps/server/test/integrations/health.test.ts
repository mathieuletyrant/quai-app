import { describe, expect, it } from "@effect/vitest"
import { Redacted } from "effect"
import { downAfterMs, makeHealthState, probesFor } from "../../src/integrations/health.ts"

const radarr = probesFor({
  radarr: { url: "http://radarr:7878", apiKey: Redacted.make("k") },
  sonarr: null,
  qbittorrent: { url: "http://qb:8080", username: null, password: null },
  jellyfin: null,
  internalUrl: null
})

describe("health", () => {
  it("one probe per configured service", () => {
    expect(radarr.map((p) => p.name)).toEqual(["radarr", "qbittorrent"])
    expect(radarr[0]!.request.headers["x-api-key"]).toBe("k")
  })

  it("down only after 5 min of failures, once; back on the first answer", () => {
    const observe = makeHealthState()
    const probe = radarr[0]!
    expect(observe(probe, true, 0)).toBeNull()
    expect(observe(probe, false, 0)).toBeNull()
    expect(observe(probe, false, downAfterMs - 1)).toBeNull()
    const down = observe(probe, false, downAfterMs)
    expect([down?.type, down?.subject?.key, down?.values?.since]).toEqual(["service.down", "service:radarr", 0])
    expect(observe(probe, false, downAfterMs + 60_000)).toBeNull()
    expect(observe(probe, true, downAfterMs + 120_000)?.type).toBe("service.up")
    expect(observe(probe, true, downAfterMs + 180_000)).toBeNull()
  })
})
