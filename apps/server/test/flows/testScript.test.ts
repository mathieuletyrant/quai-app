import { describe, expect, it } from "@effect/vitest"
import { Redacted } from "effect"
import { testScript } from "../../src/flows/TestScript.ts"
import { probesFor } from "../../src/stack/Health.ts"
import { download, incident, playback } from "./helpers.ts"

describe("test script", () => {
  it("plays every step in order, starts and ends, with fake progress where a step shows it", () => {
    const beats = testScript(download, 0, "t")
    const tags = beats.map((b) => `${b.push._tag}:${b.push.activity.stepIndex}`)
    expect(tags[0]).toBe("Start:0")
    expect(tags.at(-1)).toBe("End:3")
    expect(new Set(beats.map((b) => b.push.activity.stepIndex))).toEqual(new Set([0, 1, 2, 3]))
    const progress = beats.filter((b) => b.push.activity.values.progress !== undefined)
    expect(progress.map((b) => b.push.activity.values.progress)).toEqual([0.12, 0.31, 0.52, 0.74, 0.93, 1])
    expect(new Set(beats.map((b) => b.push.activity.key)).size).toBe(1)
  })

  it("a countdown for playback, time since for incidents", () => {
    expect(testScript(playback, 1_000, "t")[0]!.push.activity.values.endsAt).toBeGreaterThan(1_000)
    expect(testScript(incident, 1_000, "t")[0]!.push.activity.values.since).toBe(1_000)
  })
})

describe("health probes", () => {
  it("one per configured service, none for the others", () => {
    const probes = probesFor({
      radarr: { url: "http://radarr:7878", apiKey: Redacted.make("k") },
      sonarr: null,
      qbittorrent: { url: "http://qb:8080", username: null, password: null },
      jellyfin: null,
      internalUrl: null
    })
    expect(probes.map((p) => p.name)).toEqual(["radarr", "qbittorrent"])
    expect(probes[0]!.request.headers["x-api-key"]).toBe("k")
  })
})
