import { defaultDownloadPreferences, type DevicePreferences } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import type { Push } from "../../src/engine/DownloadEngine.ts"
import { deliveryFor } from "../../src/push/Targeting.ts"

const prefs = (over: Partial<DevicePreferences["download"]> = {}): DevicePreferences => ({
  download: { ...defaultDownloadPreferences, ...over }
})
const start: Push = { _tag: "Start", attributes: { mediaKey: "m", title: "Dune" }, content: { step: "searching", stalled: false } }
const downloading: Push = { _tag: "Update", mediaKey: "m", title: "Dune", content: { step: "downloading", progress: 0.4, stalled: false } }
const end: Push = { _tag: "End", mediaKey: "m", content: { step: "available", stalled: false }, dismissAt: 0 }
const fresh = { pushToStartToken: "pts", activityToken: null, shown: false }

describe("per-iPhone steps", () => {
  it("every step by default, with the steps in the attributes", () => {
    const d = deliveryFor(start, { ...fresh, preferences: prefs() }, 0)
    expect(d._tag).toBe("Start")
    if (d._tag === "Start") expect(d.push.attributes.steps).toEqual(["searching", "downloading", "importing", "available"])
  })

  it("an iPhone that hides Search starts at Download, from the update", () => {
    const p = prefs({ steps: ["downloading", "importing"] })
    expect(deliveryFor(start, { ...fresh, preferences: p }, 0)._tag).toBe("None")
    const d = deliveryFor(downloading, { ...fresh, preferences: p }, 0)
    expect(d._tag).toBe("Start")
    if (d._tag === "Start") {
      expect(d.token).toBe("pts")
      expect(d.push.attributes).toEqual({ mediaKey: "m", title: "Dune", steps: ["downloading", "importing", "available"] })
      expect(d.push.content.progress).toBe(0.4)
    }
  })

  it("a hidden step sends nothing to an iPhone already showing the activity", () => {
    const d = deliveryFor(downloading, { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: prefs({ steps: ["searching"] }) }, 0)
    expect(d._tag).toBe("None")
  })

  it("the end stays on screen as long as the iPhone asked", () => {
    const d = deliveryFor(end, { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: prefs({ lingerMinutes: 60 }) }, 1_000)
    expect(d._tag === "End" && d.push.dismissAt).toBe(1_000 + 60 * 60_000)
  })

  it("Download turned off on this iPhone: nothing at all", () => {
    expect(deliveryFor(start, { ...fresh, preferences: prefs({ enabled: false }) }, 0)._tag).toBe("None")
  })
})
