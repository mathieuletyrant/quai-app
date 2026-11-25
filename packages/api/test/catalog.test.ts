import { describe, expect, it } from "@effect/vitest"
import { builtInFlows, flowProblem, stepShows } from "../src/index.ts"

const download = builtInFlows.find((flow) => flow.id === "download")!

describe("flow rules", () => {
  it("every built-in flow passes them and only shows what its kind of flow can", () => {
    for (const flow of builtInFlows) {
      expect(flowProblem(flow)).toBeNull()
      for (const step of flow.steps) {
        const shown = Object.entries(step.show).filter(([, on]) => on).map(([key]) => key)
        expect(stepShows[flow.subject]).toEqual(expect.arrayContaining(shown))
      }
    }
  })

  it("refuses two steps on one event, and an end event that is also a step", () => {
    const steps = download.steps.map((step, index) => index === 1 ? { ...step, on: download.steps[0]!.on } : step)
    expect(flowProblem({ ...download, steps })).toBe("Two steps start on the same event.")
    expect(flowProblem({ ...download, endOn: download.steps[0]!.on })).toBe("The end event is also a step's event.")
  })

  it("a one-step flow needs a way to end", () => {
    const playback = builtInFlows.find((flow) => flow.id === "playback")!
    const { endOn: _end, expireAfterMinutes: _expire, ...endless } = playback
    expect(flowProblem(endless)).toBe("A one-step flow needs an end event or an end after no news.")
  })
})

describe("request flows", () => {
  it("never end after no news: a request pending for days would start again every day", () => {
    const request = builtInFlows.find((flow) => flow.id === "request")!
    expect(flowProblem(request)).toBeNull()
    expect(flowProblem({ ...request, expireAfterMinutes: 1440 })).toMatch(/not after no news/)
  })
})
