import { describe, expect, it } from "@effect/vitest"
import * as DeviceToken from "@quai/domain/home/DeviceToken.ts"
import { Option } from "effect"

describe("device token", () => {
  it("names its home, and only a token Quai made names one", () => {
    const homeId = "0123456789abcdef0123456789abcdef"
    const token = DeviceToken.make(homeId)
    expect(token).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/)
    expect(DeviceToken.homeOf(token)).toEqual(Option.some(homeId))
    expect(DeviceToken.make(homeId)).not.toBe(token)
    // An iPhone paired before: the secret alone.
    expect(DeviceToken.homeOf("A".repeat(43))).toEqual(Option.none())
    expect(DeviceToken.homeOf(`${homeId.toUpperCase()}.${"a".repeat(43)}`)).toEqual(Option.none())
    expect(DeviceToken.homeOf(`${homeId}.short`)).toEqual(Option.none())
  })
})
