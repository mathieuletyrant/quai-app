import { describe, expect, it } from "vitest"
import { type CloudLink, isHostedCloud } from "../src/index.ts"

const link = (url?: string): CloudLink => ({
  configured: url !== undefined,
  linked: true,
  ...(url === undefined ? {} : { url })
})

describe("isHostedCloud", () => {
  it("recognises Quai's hosted Cloud, as Quai Home derives it from wss://cloud.quai.stream/home", () => {
    expect(isHostedCloud(link("https://cloud.quai.stream"))).toBe(true)
    expect(isHostedCloud(link("https://cloud.quai.stream/"))).toBe(true)
  })

  it("treats any other address, or none, as a Cloud of one's own", () => {
    expect(isHostedCloud(link("http://umbrel.local:3078"))).toBe(false)
    expect(isHostedCloud(link("https://cloud.quai.stream.example.com"))).toBe(false)
    expect(isHostedCloud(link("http://cloud.quai.stream"))).toBe(false)
    expect(isHostedCloud(link())).toBe(false)
  })
})
