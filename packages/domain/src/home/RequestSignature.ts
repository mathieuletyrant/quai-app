import { RequestSignature } from "@quai/api"
import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto"

/** A request as its signature covers it, and what it carried to prove it. */
export interface SignedRequest {
  readonly method: string
  /** Path and query, as received. */
  readonly path: string
  /** As received: "" when there is none. */
  readonly body: string
  readonly time: string | undefined
  readonly nonce: string | undefined
  readonly signature: string | undefined
}

/** Why a request from an iPhone with a device key isn't answered. */
export type SignatureProblem = "unsigned" | "clock" | "forged" | "replayed"

/** What the iPhone is told, for each problem: it is still paired, and can act on these. */
export const problemMessages: Record<SignatureProblem, string> = {
  unsigned: "This iPhone signs its requests, and this one wasn't signed. Update the app, or pair this iPhone again.",
  clock: "This iPhone's clock and your server's are more than 5 minutes apart. Set the date and time, then try again.",
  forged: "This request wasn't signed by this iPhone. Pair it again if this goes on.",
  replayed: "This request was already answered."
}

/** DER header of an Ed25519 public key (SPKI): the 32 raw bytes follow. */
const ed25519Spki = Buffer.from("302a300506032b6570032100", "hex")

export const bodyHash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex")

/** Whether `signature` is this device key's signature of the request. A key or signature that can't be read isn't. */
export const signedBy = (
  deviceKey: string,
  request: SignedRequest & { readonly time: string; readonly nonce: string }
) => {
  try {
    const raw = Buffer.from(deviceKey, "base64")
    if (raw.length !== 32) return false
    const key = createPublicKey({ key: Buffer.concat([ed25519Spki, raw]), format: "der", type: "spki" })
    const payload = RequestSignature.signedPayload({
      method: request.method,
      path: request.path,
      time: request.time,
      nonce: request.nonce,
      bodyHash: bodyHash(request.body)
    })
    return verify(null, Buffer.from(payload, "utf8"), key, Buffer.from(request.signature ?? "", "base64"))
  } catch {
    return false
  }
}

/**
 * The nonces of the requests answered lately, so each is answered once. A nonce is kept for twice
 * the window: past that its request would be refused for its time alone.
 */
export const makeNonces = (limit = 20_000) => {
  /** Nonce → when it may be forgotten; in the order they came, so the oldest are first. */
  const seen = new Map<string, number>()
  return {
    /** False when this nonce was already taken; else takes it. */
    take: (nonce: string, now: number): boolean => {
      for (const [old, until] of seen) {
        if (until > now && seen.size < limit) break
        seen.delete(old)
      }
      if (seen.has(nonce)) return false
      seen.set(nonce, now + 2 * RequestSignature.signatureWindowMs)
      return true
    }
  }
}

/**
 * What is wrong with a request from an iPhone that has this device key, at `now` (the home's
 * clock); undefined when it is the iPhone's own, fresh, and not seen before. The nonce is taken
 * only by a request that is otherwise right, so a forged one can't use it up.
 */
export const signatureProblem = (
  deviceKey: string,
  request: SignedRequest,
  now: number,
  nonces: ReturnType<typeof makeNonces>
): SignatureProblem | undefined => {
  const { nonce, signature, time } = request
  if (time === undefined || nonce === undefined || signature === undefined || nonce === "") return "unsigned"
  const at = Number(time)
  if (!Number.isFinite(at) || Math.abs(now - at) > RequestSignature.signatureWindowMs) return "clock"
  if (!signedBy(deviceKey, { ...request, time, nonce })) return "forged"
  return nonces.take(nonce, now) ? undefined : "replayed"
}

/** DER header of an Ed25519 private key (PKCS #8): the 32 bytes of its seed follow. */
const ed25519Pkcs8 = Buffer.from("302e020100300506032b657004220420", "hex")

/** A device key from its 32-byte seed, as the app keeps it: for the tests and the preview's iPhones. */
export const deviceKeyOf = (seed: Uint8Array): { readonly privateKey: KeyObject; readonly publicKey: string } => {
  const privateKey = createPrivateKey({ key: Buffer.concat([ed25519Pkcs8, seed]), format: "der", type: "pkcs8" })
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" })
  return { privateKey, publicKey: spki.subarray(ed25519Spki.length).toString("base64") }
}

/** The three headers an iPhone adds to a request, signed with its device key: what the app does. */
export const signatureHeadersOf = (
  privateKey: KeyObject,
  request: Pick<SignedRequest, "method" | "path" | "body"> & { readonly time: number; readonly nonce: string }
): Record<string, string> => {
  const time = String(request.time)
  const payload = RequestSignature.signedPayload({
    method: request.method,
    path: request.path,
    time,
    nonce: request.nonce,
    bodyHash: bodyHash(request.body)
  })
  return {
    [RequestSignature.signatureHeaders.time]: time,
    [RequestSignature.signatureHeaders.nonce]: request.nonce,
    [RequestSignature.signatureHeaders.signature]: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
      "base64"
    )
  }
}
