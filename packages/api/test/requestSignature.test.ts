import { describe, expect, it } from "vitest"
import { HomeProtocol, RequestSignature } from "../src/index.ts"

describe("what a device key signs", () => {
  it("is the method, the path as it reads, the time, the nonce and the body's hash, one per line", () => {
    expect(
      RequestSignature.signedPayload({
        method: "post",
        path: "/api/search?query=l%27%C3%A9t%C3%A9%20indien",
        time: "1795780000000",
        nonce: "n-0001",
        bodyHash: "6442fa400575468d43a22425ba3cc684670d3b02d8b855ce32b6f1e99a03909b"
      })
    ).toBe(
      "quai-request\nPOST\n/api/search?query=l'été indien\n1795780000000\nn-0001\n" +
        "6442fa400575468d43a22425ba3cc684670d3b02d8b855ce32b6f1e99a03909b"
    )
  })

  it("reads a path the same however a proxy wrote it; one that can't be decoded is signed as it is", () => {
    expect(RequestSignature.signedPath("/api/search?query=a%20b")).toBe("/api/search?query=a b")
    expect(RequestSignature.signedPath("/api/search?query=a b")).toBe("/api/search?query=a b")
    expect(RequestSignature.signedPath("/api/library")).toBe("/api/library")
    expect(RequestSignature.signedPath("/api/search?query=100%")).toBe("/api/search?query=100%")
  })

  it("travels with the request: Quai Cloud relays the three headers to the home", () => {
    for (const header of Object.values(RequestSignature.signatureHeaders)) {
      expect(HomeProtocol.relayedHeaders).toContain(header)
    }
  })
})
