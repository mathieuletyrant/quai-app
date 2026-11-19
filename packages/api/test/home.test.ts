import { describe, expect, it } from "@effect/vitest"
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import { HomeProtocol } from "../src/index.ts"

describe("home id", () => {
  it("is the first 32 hex chars of the SHA-256 of the public key (SPKI DER)", () => {
    for (let i = 0; i < 5; i++) {
      const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64")
      const expected = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32)
      expect(HomeProtocol.homeId(publicKey)).toBe(expected)
    }
  })

  it("hashes any length, across block boundaries", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const bytes = randomBytes(length)
      const expected = createHash("sha256").update(bytes).digest("hex").slice(0, 32)
      expect(HomeProtocol.homeId(bytes.toString("base64"))).toBe(expected)
    }
  })
})
