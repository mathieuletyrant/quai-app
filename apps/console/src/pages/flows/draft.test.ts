import { builtInFlows } from "@quai/api"
import { describe, expect, it } from "vitest"
import { clone, showsSteps } from "./draft.ts"

const flow = (id: string) => clone(builtInFlows.find((candidate) => candidate.id === id)!)

describe("the preview's row of steps", () => {
  it("shows a download's steps", () => {
    expect(showsSteps(flow("download"))).toBe(true)
  })

  it("leaves it out for a request, whose buttons say where it stands", () => {
    const requests = builtInFlows.find((candidate) => candidate.subject === "request")!
    expect(showsSteps(clone(requests))).toBe(false)
  })
})
