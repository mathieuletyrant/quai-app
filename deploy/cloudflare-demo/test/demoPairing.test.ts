import { describe, expect, it } from "vitest"
import { demoCode, isDemoCode, isPublic, withFreshCode } from "../src/demoPairing.ts"

describe("the demo's pairing", () => {
  it("knows the demo code however it is typed, nothing else", () => {
    expect(isDemoCode(demoCode)).toBe(true)
    expect(isDemoCode(" quaidemo ")).toBe(true)
    expect(isDemoCode("ABCD2345")).toBe(false)
    expect(isDemoCode(undefined)).toBe(false)
    expect(isDemoCode(42)).toBe(false)
  })

  it("sends the pairing on with the fresh code, the rest as the iPhone sent it", () => {
    const body = { code: "QUAIDEMO", name: "iPhone", apnsEnvironment: "production" }
    expect(withFreshCode(body, "K7M2P9QX")).toEqual({ ...body, code: "K7M2P9QX" })
  })

  it("keeps the console's routes to the Worker", () => {
    expect(isPublic("/api/devices")).toBe(true)
    expect(isPublic("/api/library")).toBe(true)
    expect(isPublic("/console-api/pairing-codes")).toBe(false)
    expect(isPublic("/console-api/devices")).toBe(false)
  })
})
