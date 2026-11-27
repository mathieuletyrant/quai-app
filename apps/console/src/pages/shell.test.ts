import { describe, expect, it } from "vitest"
import { cloudStateOf, needsSettings, versionLabel } from "./shell.ts"

const hosted = { configured: true, linked: true, url: "https://cloud.quai.stream", version: "2.5.0" }
const own = { configured: true, linked: true, url: "http://cloud.lan:8787", version: "2.5.0" }

describe("the Settings page", () => {
  it("is for a Cloud of one's own, or none set yet; Quai's hosted Cloud has nothing to set", () => {
    expect(needsSettings(own)).toBe(true)
    expect(needsSettings({ configured: false, linked: false })).toBe(true)
    expect(needsSettings(hosted)).toBe(false)
    expect(needsSettings({ ...hosted, url: "https://cloud.quai.stream/" })).toBe(false)
    // Not known yet: shown, so the page doesn't jump once Quai Home answers.
    expect(needsSettings(null)).toBe(true)
  })
})

describe("Quai Cloud in the sidebar", () => {
  it("says its version while linked, as Quai Home's", () => {
    expect(cloudStateOf("online", hosted)).toEqual({ tone: "ok", text: "v2.5.0" })
    expect(cloudStateOf("online", { ...hosted, version: "dev" })).toEqual({ tone: "ok", text: "dev" })
  })

  it("says Connected for a Cloud too old to say its version", () => {
    const { version: _, ...older } = hosted
    expect(cloudStateOf("online", older)).toEqual({ tone: "ok", text: "Connected" })
    expect(cloudStateOf("online", null)).toEqual({ tone: "ok", text: "Connected" })
  })

  it("says the link's state otherwise, and Not set before there is a Cloud", () => {
    expect(cloudStateOf("offline", hosted)).toEqual({ tone: "danger", text: "Not connected" })
    expect(cloudStateOf("checking", hosted)).toEqual({ tone: "neutral", text: "Checking…" })
    expect(cloudStateOf("online", { configured: false, linked: false })).toEqual({ tone: "warn", text: "Not set" })
  })

  it("writes a release's version with a v, anything else as is", () => {
    expect(versionLabel("2.5.0")).toBe("v2.5.0")
    expect(versionLabel("dev")).toBe("dev")
  })
})
