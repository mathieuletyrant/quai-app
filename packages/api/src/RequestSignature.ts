/**
 * How an iPhone signs its requests with its device key
 * ([ADR 3](../../../docs/adr/0003-quai-home-runs-quai.md)): what goes on the wire, for the app and
 * the home to agree on. Quai Cloud carries a request and can neither make one nor play one again.
 *
 * The app sends three headers with each request: its clock (`time`, epoch milliseconds), a random
 * `nonce`, and the Ed25519 `signature` (base64) of `signedPayload`, made with the device key. The
 * home answers a signed request once, and only one made within `signatureWindowMs` of its own clock.
 */
export const signatureHeaders = {
  time: "x-quai-time",
  nonce: "x-quai-nonce",
  signature: "x-quai-signature"
} as const

/** How far an iPhone's clock may be from its home's, each way; a nonce is remembered for twice as long. */
export const signatureWindowMs = 5 * 60_000

/**
 * A path as it is signed: percent-decoded, so a proxy on the way that writes the same path another
 * way (`%20` or `%2520` aside) doesn't break the signature. One that can't be decoded is signed as it is.
 */
export const signedPath = (path: string): string => {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * What the device key signs, as UTF-8: the method, the path and query, the two headers, and the
 * SHA-256 (hex) of the body as sent (of nothing, for a request without one). The first line keeps
 * the signature from being one of anything else.
 */
export const signedPayload = (request: {
  readonly method: string
  /** Path and query, as sent. */
  readonly path: string
  readonly time: string
  readonly nonce: string
  readonly bodyHash: string
}): string =>
  [
    "quai-request",
    request.method.toUpperCase(),
    signedPath(request.path),
    request.time,
    request.nonce,
    request.bodyHash
  ]
    .join("\n")
