import { describe, expect, it } from "@effect/vitest"
import type { DevicePreferences } from "@quai/api"
import type { Activity, Push } from "@quai/domain/flows/Engine.ts"
import { deliveryFor } from "@quai/domain/flows/Targeting.ts"
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
  lookup: null,
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
    const delivery = deliveryFor(push("Start"), download, { ...fresh, preferences: { flows: {} } }, 0)
    expect(delivery._tag).toBe("Start")
    if (delivery._tag === "Start") {
      expect(delivery.attributes).toMatchObject({
        flowId: "download",
        color: "#FFC230",
        icon: "arrow.down",
        title: "Dune"
      })
      expect(delivery.attributes.steps.map((step) => step.id)).toEqual([
        "searching",
        "downloading",
        "importing",
        "available"
      ])
      expect(delivery.content).toEqual({ step: 0, tone: "active" })
    }
  })

  it("hiding Searching: nothing at first, the start comes with Downloading, indexes shift", () => {
    const preferences = prefs(["searching"])
    expect(deliveryFor(push("Start"), download, { ...fresh, preferences }, 0)._tag).toBe("None")
    const delivery = deliveryFor(
      push("Update", { stepIndex: 1, values: { progress: 0.4, bytesPerSecond: 9, remainingSeconds: 5 } }),
      download,
      { ...fresh, preferences },
      0
    )
    expect(delivery._tag).toBe("Start")
    if (delivery._tag === "Start") {
      expect(delivery.attributes.steps.map((step) => step.id)).toEqual(["downloading", "importing", "available"])
      expect(delivery.content).toEqual({
        step: 0,
        tone: "active",
        progress: 0.4,
        bytesPerSecond: 9,
        remainingSeconds: 5
      })
    }
  })

  it("values a step doesn't show are left out", () => {
    const delivery = deliveryFor(push("Update", { stepIndex: 2, values: { progress: 1 } }), download, {
      pushToStartToken: "pts",
      activityToken: "act",
      shown: true,
      preferences: prefs()
    }, 0)
    expect(delivery._tag === "Update" && delivery.content).toEqual({ step: 2, tone: "active" })
  })

  it("the end stays the flow's linger; a turned-off flow gets nothing", () => {
    const end = deliveryFor(push("End", { stepIndex: 3, endedAt: 1_000 }), download, {
      pushToStartToken: "pts",
      activityToken: "act",
      shown: true,
      preferences: prefs()
    }, 1_000)
    expect(end._tag === "End" && end.dismissAt).toBe(1_000 + 15 * 60_000)
    expect(deliveryFor(push("Start"), download, { ...fresh, preferences: prefs([], false) }, 0)._tag).toBe("None")
  })

  it("playback: the timeline in seconds for the iPhone to animate, and the buttons in the attributes", () => {
    const delivery = deliveryFor(
      {
        _tag: "Start",
        activity: activity({
          flowId: "playback",
          values: { paused: false, startsAt: 20_000, endsAt: 120_500, detail: "TV Salon" }
        })
      },
      playback,
      { ...fresh, preferences: { flows: {} } },
      0
    )
    expect(delivery._tag === "Start" && delivery.content).toEqual({
      step: 0,
      tone: "active",
      endsAt: 120,
      startsAt: 20,
      paused: false,
      detail: "TV Salon"
    })
    expect(delivery._tag === "Start" && delivery.attributes.steps).toEqual([
      { id: "playing", label: "Playing", icon: "play.fill", actions: ["playback.playPause", "playback.stop"] }
    ])
  })

  it("playback paused: the bar holds at its fraction", () => {
    const delivery = deliveryFor(
      { _tag: "Update", activity: activity({ flowId: "playback", values: { paused: true, progress: 0.25 } }) },
      playback,
      { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: { flows: {} } },
      0
    )
    expect(delivery._tag === "Update" && delivery.content).toEqual({
      step: 0,
      tone: "active",
      paused: true,
      progress: 0.25
    })
  })

  it("playback paused: sent even when the step doesn't show the countdown, for the label and the button", () => {
    const withoutTimer = { ...playback, steps: playback.steps.map((step) => ({ ...step, show: {} })) }
    const delivery = deliveryFor(
      { _tag: "Update", activity: activity({ flowId: "playback", values: { paused: true, progress: 0.25 } }) },
      withoutTimer,
      { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: { flows: {} } },
      0
    )
    expect(delivery._tag === "Update" && delivery.content).toEqual({ step: 0, tone: "active", paused: true })
  })

  it("swiped away: stays away while nothing changes, starts again on a pause, a resume or a step", () => {
    const target = {
      pushToStartToken: "pts",
      activityToken: null,
      shown: false,
      preferences: { flows: {} },
      dismissed: { stepIndex: 0, paused: false }
    }
    const at = (values: Activity["values"], stepIndex = 0) => ({
      _tag: "Update" as const,
      activity: activity({ flowId: "playback", stepIndex, values })
    })
    expect(deliveryFor(at({ paused: false, endsAt: 99_000 }), playback, target, 0)._tag).toBe("None")
    expect(deliveryFor(at({ paused: true, progress: 0.4 }), playback, target, 0)._tag).toBe("Start")
    expect(deliveryFor({ _tag: "End", activity: activity({ flowId: "playback" }) }, playback, target, 0)._tag).toBe(
      "None"
    )
    expect(deliveryFor(at({}, 2), download, { ...target, dismissed: { stepIndex: 1, paused: null } }, 0)._tag).toBe(
      "Start"
    )
  })

  it("playback ignores an old Progress setting: the countdown stays, with no stale fraction", () => {
    const withProgress = {
      ...playback,
      steps: playback.steps.map((step) => ({ ...step, show: { ...step.show, progress: true } }))
    }
    const delivery = deliveryFor(
      {
        _tag: "Update",
        activity: activity({
          flowId: "playback",
          values: { paused: false, progress: 0, startsAt: 20_000, endsAt: 120_000 }
        })
      },
      withProgress,
      { pushToStartToken: "pts", activityToken: "act", shown: true, preferences: { flows: {} } },
      0
    )
    expect(delivery._tag === "Update" && delivery.content).toEqual({
      step: 0,
      tone: "active",
      endsAt: 120,
      startsAt: 20,
      paused: false
    })
  })
})
