import type { DevicePreferences } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import type { Activity, Push } from "../../src/flows/Engine.ts"
import { deliveryFor } from "../../src/flows/Targeting.ts"
import { download, playback } from "./helpers.ts"

const activity = (over: Partial<Activity> = {}): Activity => ({
  key: "download|movie:tmdb:1",
  flowId: "download",
  subjectKey: "movie:tmdb:1",
  title: "Dune",
  stepIndex: 0,
  tone: "active",
  values: {},
  downloadId: null,
  enteredAt: 0,
  movedAt: 0,
  lastEventAt: 0,
  endedAt: null,
  pushedAt: 0,
  pushedFingerprint: null,
  ...over
})
const prefs = (hiddenSteps: Array<string> = [], enabled = true): DevicePreferences => ({
  flows: { download: { enabled, hiddenSteps } }
})
const fresh = { pushToStartToken: "pts", activityToken: null, shown: false }
const push = (tag: Push["_tag"], over: Partial<Activity> = {}): Push => ({ _tag: tag, activity: activity(over) })

describe("per-iPhone steps", () => {
  it("every step by default, the flow's look in the attributes", () => {
    const d = deliveryFor(push("Start"), download, { ...fresh, preferences: { flows: {} } }, 0)
    expect(d._tag).toBe("Start")
    if (d._tag === "Start") {
      expect(d.attributes).toMatchObject({ flowId: "download", color: "#FFC230", icon: "arrow.down", title: "Dune" })
      expect(d.attributes.steps.map((s) => s.id)).toEqual(["searching", "downloading", "importing", "available"])
      expect(d.content).toEqual({ step: 0, tone: "active" })
    }
  })

  it("hiding Searching: nothing at first, the start comes with Downloading, indexes shift", () => {
    const p = prefs(["searching"])
    expect(deliveryFor(push("Start"), download, { ...fresh, preferences: p }, 0)._tag).toBe("None")
    const d = deliveryFor(push("Update", { stepIndex: 1, values: { progress: 0.4, bytesPerSecond: 9, remainingSeconds: 5 } }), download, { ...fresh, preferences: p }, 0)
    expect(d._tag).toBe("Start")
    if (d._tag === "Start") {
      expect(d.attributes.steps.map((s) => s.id)).toEqual(["downloading", "importing", "available"])
      expect(d.content).toEqual({ step: 0, tone: "active", progress: 0.4, bytesPerSecond: 9, remainingSeconds: 5 })
    }
  })

  it("values a step doesn't show are left out", () => {
    const d = deliveryFor(push("Update", { stepIndex: 2, values: { progress: 1 } }), download, { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: prefs() }, 0)
    expect(d._tag === "Update" && d.content).toEqual({ step: 2, tone: "active" })
  })

  it("the end stays the flow's linger; a turned-off flow gets nothing", () => {
    const end = deliveryFor(push("End", { stepIndex: 3, endedAt: 1_000 }), download, { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: prefs() }, 1_000)
    expect(end._tag === "End" && end.dismissAt).toBe(1_000 + 15 * 60_000)
    expect(deliveryFor(push("Start"), download, { ...fresh, preferences: prefs([], false) }, 0)._tag).toBe("None")
  })

  it("playback: the timeline in seconds for the iPhone to animate, and the buttons in the attributes", () => {
    const d = deliveryFor(
      { _tag: "Start", activity: activity({ flowId: "playback", values: { paused: false, startsAt: 20_000, endsAt: 120_500, detail: "TV Salon" } }) },
      playback,
      { ...fresh, preferences: { flows: {} } },
      0
    )
    expect(d._tag === "Start" && d.content).toEqual({ step: 0, tone: "active", endsAt: 120, startsAt: 20, paused: false, detail: "TV Salon" })
    expect(d._tag === "Start" && d.attributes.steps).toEqual([
      { id: "playing", label: "Playing", icon: "play.fill", actions: ["playback.playPause", "playback.stop"] }
    ])
  })

  it("playback paused: the bar holds at its fraction", () => {
    const d = deliveryFor(
      { _tag: "Update", activity: activity({ flowId: "playback", values: { paused: true, progress: 0.25 } }) },
      playback,
      { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: { flows: {} } },
      0
    )
    expect(d._tag === "Update" && d.content).toEqual({ step: 0, tone: "active", paused: true, progress: 0.25 })
  })
})
