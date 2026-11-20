import { createHash } from "node:crypto"

/**
 * The home id: the fingerprint of its public key (SPKI DER, base64), the first 32 hex chars of its
 * SHA-256. Server-only (`@quai/api/HomeId`, on `node:crypto`): Quai Home and Quai Cloud compute
 * it, the console never does.
 */
export const homeId = (publicKey: string): string =>
  createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32)
