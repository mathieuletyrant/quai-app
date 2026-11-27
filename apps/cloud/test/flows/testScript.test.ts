import { describe, expect, it } from "@effect/vitest"
import { builtInFlows } from "@quai/api"
import { testScript } from "@quai/domain/flows/TestScript.ts"
import { download, playback } from "./helpers.ts"

describe("test script", () => {
  it("plays every step in order, starts and ends, with fake progress where a step shows it", () => {
    const beats = testScript(download, 0, "t")
    const tags = beats.map((beat) => `${beat.push._tag}:${beat.push.activity.stepIndex}`)
    expect(tags[0]).toBe("Start:0")
    expect(tags.at(-1)).toBe("End:3")
    expect(new Set(beats.map((beat) => beat.push.activity.stepIndex))).toEqual(new Set([0, 1, 2, 3]))
    const progress = beats.filter((beat) => beat.push.activity.values.progress !== undefined)
    expect(progress.map((beat) => beat.push.activity.values.progress)).toEqual([0.12, 0.31, 0.52, 0.74, 0.93, 1])
    expect(new Set(beats.map((beat) => beat.push.activity.key)).size).toBe(1)
  })

  it("playback: a timeline, a pause and a resume, then the end event closes it", () => {
    const beats = testScript(playback, 1_000, "t")
    expect(beats[0]!.push.activity.values).toMatchObject({ paused: false, startsAt: 1_000, endsAt: 41_000 })
    expect(beats.map((beat) => beat.push._tag)).toEqual(["Start", "Update", "Update", "End"])
    expect(beats.map((beat) => beat.push.activity.values.paused)).toEqual([false, true, false, false])
  })

  it("requests: the requester, and the last step ends it as the engine would, end event or not", () => {
    const request = builtInFlows.find((flow) => flow.id === "request")!
    const beats = testScript(request, 0, "t")
    expect(beats.map((beat) => `${beat.push._tag}:${beat.push.activity.stepIndex}`)).toEqual(["Start:0", "End:1"])
    expect(beats[0]!.push.activity).toMatchObject({
      title: "Big Buck Bunny (test)",
      values: { detail: "Julie · Movie · 2008" }
    })
  })

  it("today's releases: a few lines ticked off, the whole count, then all here", () => {
    const today = builtInFlows.find((flow) => flow.id === "today")!
    const beats = testScript(today, 0, "t")
    expect(beats.map((beat) => `${beat.push._tag}:${beat.push.activity.stepIndex}`)).toEqual([
      "Start:0",
      "Update:0",
      "End:1"
    ])
    expect(beats[0]!.push.activity.title).toBe("Today (test)")
    expect(beats.map((beat) => [beat.push.activity.values.here, beat.push.activity.values.total])).toEqual([[1, 4], [
      2,
      4
    ], [4, 4]])
    expect(beats[0]!.push.activity.values.items?.map((item) => item.state)).toEqual([
      "done",
      "active",
      "waiting",
      "waiting"
    ])
  })
})
