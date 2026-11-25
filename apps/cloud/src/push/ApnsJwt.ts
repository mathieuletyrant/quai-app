import { createPrivateKey, sign } from "node:crypto"

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url")

/**
 * The provider token APNs expects: ES256, `kid` = key id, `iss` = team id. Valid 20 to 60 min;
 * the client reuses it and signs a new one well before that.
 */
export const signApnsJwt = (
  input: { readonly keyPem: string; readonly keyId: string; readonly teamId: string; readonly issuedAt: number }
) => {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: input.keyId }))
  const claims = base64url(JSON.stringify({ iss: input.teamId, iat: Math.floor(input.issuedAt / 1000) }))
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(input.keyPem),
    dsaEncoding: "ieee-p1363"
  })
  return `${header}.${claims}.${base64url(signature)}`
}
