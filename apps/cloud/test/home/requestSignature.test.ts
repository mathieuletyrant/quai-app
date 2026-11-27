import { RequestSignature } from "@quai/api"
import {
  bodyHash,
  deviceKeyOf,
  makeNonces,
  signatureHeadersOf,
  signatureProblem,
  signedBy,
  type SignedRequest
} from "@quai/domain/home/RequestSignature.ts"
import { describe, expect, it } from "vitest"

const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const key = deviceKeyOf(seed)
const now = 1_795_780_000_000
const headers = RequestSignature.signatureHeaders

/** A request as the home receives it, signed by `key` at `time`. */
const received = (
  request: { readonly method?: string; readonly path?: string; readonly body?: string } = {},
  signed: { readonly time?: number; readonly nonce?: string } = {}
): SignedRequest => {
  const asked = { method: request.method ?? "GET", path: request.path ?? "/api/library", body: request.body ?? "" }
  const carried = signatureHeadersOf(key.privateKey, {
    ...asked,
    time: signed.time ?? now,
    nonce: signed.nonce ?? "n1"
  })
  return { ...asked, time: carried[headers.time], nonce: carried[headers.nonce], signature: carried[headers.signature] }
}

describe("a device key's signature", () => {
  // The same vector is in the app's tests (`RequestSigningTests.swift`): both sides sign alike.
  it("is the one the app makes: a known key, request and signature", () => {
    const request = {
      method: "post",
      path: "/api/search?query=l%27%C3%A9t%C3%A9%20indien",
      body: "{\"note\":\"é\"}"
    }
    expect(key.publicKey).toBe("ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=")
    expect(bodyHash(request.body)).toBe("6442fa400575468d43a22425ba3cc684670d3b02d8b855ce32b6f1e99a03909b")
    expect(signatureHeadersOf(key.privateKey, { ...request, time: now, nonce: "n-0001" })).toEqual({
      "x-quai-time": "1795780000000",
      "x-quai-nonce": "n-0001",
      "x-quai-signature": "taQFlKbZZcL6WsfB4rBWQW14HOjcKk1D6zObXE1Icl4M1r6Hhn8/OKj/RVz4MIerMoYYp49KbcyXcAzTFUQ8BQ=="
    })
  })

  it("is this iPhone's own, of this request: nothing else passes", () => {
    const request = received({ method: "POST", path: "/api/requests/12/approve", body: "{\"a\":1}" })
    const signed = { ...request, time: request.time!, nonce: request.nonce! }
    expect(signedBy(key.publicKey, signed)).toBe(true)
    // A path written another way by a proxy is the same path.
    expect(
      signedBy(
        key.publicKey,
        { ...received({ path: "/api/search?query=a%20b" }), path: "/api/search?query=a b" } as typeof signed
      )
    )
      .toBe(true)
    const other = deviceKeyOf(Uint8Array.from({ length: 32 }, () => 9)).publicKey
    expect(signedBy(other, signed)).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, method: "DELETE" })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, path: "/api/requests/13/approve" })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, body: "{\"a\":2}" })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, time: String(now + 1) })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, nonce: "n2" })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, signature: "AAAA" })).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, signature: undefined })).toBe(false)
    // A key that isn't one, or a signature that isn't base64: not signed, never a crash.
    expect(signedBy("not a key", signed)).toBe(false)
    expect(signedBy("", signed)).toBe(false)
    expect(signedBy(key.publicKey, { ...signed, signature: "💥" })).toBe(false)
  })
})

describe("what is wrong with a request", () => {
  it("nothing, for the iPhone's own, fresh and new", () => {
    expect(signatureProblem(key.publicKey, received(), now, makeNonces())).toBeUndefined()
    expect(signatureProblem(key.publicKey, received({ method: "POST", body: "{}" }), now, makeNonces())).toBeUndefined()
  })

  it("unsigned: a header is missing, or the nonce is empty", () => {
    const request = received()
    for (const missing of ["time", "nonce", "signature"] as const) {
      expect(signatureProblem(key.publicKey, { ...request, [missing]: undefined }, now, makeNonces())).toBe("unsigned")
    }
    expect(signatureProblem(key.publicKey, received({}, { nonce: "" }), now, makeNonces())).toBe("unsigned")
  })

  it("clock: signed more than the window before or after the home's clock, or at no time at all", () => {
    const window = RequestSignature.signatureWindowMs
    const at = (time: number) => signatureProblem(key.publicKey, received({}, { time }), now, makeNonces())
    expect(at(now - window)).toBeUndefined()
    expect(at(now + window)).toBeUndefined()
    expect(at(now - window - 1)).toBe("clock")
    expect(at(now + window + 1)).toBe("clock")
    expect(signatureProblem(key.publicKey, { ...received(), time: "yesterday" }, now, makeNonces())).toBe("clock")
  })

  it("forged: signed by another key, or changed on the way", () => {
    const other = deviceKeyOf(Uint8Array.from({ length: 32 }, () => 9)).publicKey
    expect(signatureProblem(other, received(), now, makeNonces())).toBe("forged")
    expect(signatureProblem(key.publicKey, { ...received(), path: "/api/fixes" }, now, makeNonces())).toBe("forged")
  })

  it("replayed: the same request again; a forged one doesn't use its nonce up", () => {
    const nonces = makeNonces()
    const request = received()
    expect(signatureProblem(key.publicKey, { ...request, path: "/api/fixes" }, now, nonces)).toBe("forged")
    expect(signatureProblem(key.publicKey, request, now, nonces)).toBeUndefined()
    expect(signatureProblem(key.publicKey, request, now + 1_000, nonces)).toBe("replayed")
    expect(signatureProblem(key.publicKey, received({}, { nonce: "n2" }), now, nonces)).toBeUndefined()
  })
})

describe("the nonces remembered", () => {
  it("are each taken once, and forgotten after twice the window, when their request is too old anyway", () => {
    const nonces = makeNonces()
    expect(nonces.take("a", now)).toBe(true)
    expect(nonces.take("a", now + 1)).toBe(false)
    expect(nonces.take("a", now + 2 * RequestSignature.signatureWindowMs - 1)).toBe(false)
    expect(nonces.take("a", now + 2 * RequestSignature.signatureWindowMs)).toBe(true)
  })

  it("are at most the limit: the oldest go first", () => {
    const nonces = makeNonces(3)
    for (const nonce of ["a", "b", "c", "d"]) expect(nonces.take(nonce, now)).toBe(true)
    expect(nonces.take("d", now)).toBe(false)
    expect(nonces.take("c", now)).toBe(false)
    expect(nonces.take("a", now)).toBe(true)
  })
})
