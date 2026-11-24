import { describe, expect, it } from "vitest"
import { withConsoleAddresses } from "./pairing.ts"

const link = "quai://pair?code=ABCD&url=https%3A%2F%2Fcloud.quai.stream"

describe("withConsoleAddresses", () => {
  it("adds the address the console was opened at, then the public one", () => {
    expect(withConsoleAddresses(link, "http://umbrel.local:3078", "https://quai.example.com/"))
      .toBe(`${link}&console=http%3A%2F%2Fumbrel.local%3A3078&console=https%3A%2F%2Fquai.example.com`)
  })

  it("adds it once when the console was opened at its public address", () => {
    expect(withConsoleAddresses(link, "https://quai.example.com", "https://quai.example.com"))
      .toBe(`${link}&console=https%3A%2F%2Fquai.example.com`)
  })

  it("without a public address, only the one the console was opened at", () => {
    expect(withConsoleAddresses("quai://pair", "http://umbrel.local:3078", undefined)).toBe("quai://pair?console=http%3A%2F%2Fumbrel.local%3A3078")
  })
})
