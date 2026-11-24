import { describe, expect, it } from "vitest"
import { withConsoleAddress } from "./pairing.ts"

describe("withConsoleAddress", () => {
  it("adds the console's address to the pairing link, encoded", () => {
    expect(withConsoleAddress("quai://pair?code=ABCD&url=https%3A%2F%2Fcloud.quai.stream", "http://umbrel.local:3078"))
      .toBe("quai://pair?code=ABCD&url=https%3A%2F%2Fcloud.quai.stream&console=http%3A%2F%2Fumbrel.local%3A3078")
  })

  it("starts the query when the link has none", () => {
    expect(withConsoleAddress("quai://pair", "https://quai.example.com")).toBe("quai://pair?console=https%3A%2F%2Fquai.example.com")
  })
})
