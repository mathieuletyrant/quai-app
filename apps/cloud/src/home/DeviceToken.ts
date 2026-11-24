import { Option } from "effect"
import { randomBytes } from "node:crypto"

const pattern = /^([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/

/**
 * An iPhone's bearer token: `<home id>.<secret>`, so a request finds its home before the token is
 * checked against that home's paired iPhones. The home id is no secret (it names a public key).
 * Tokens issued before Quai Cloud served several homes are the secret alone.
 */
export const make = (homeId: string): string => `${homeId}.${randomBytes(32).toString("base64url")}`

/** The home a token names; None for one issued before (the secret alone) or one Quai never made. */
export const homeOf = (token: string): Option.Option<string> => {
  const match = pattern.exec(token)
  return match === null ? Option.none() : Option.some(match[1]!)
}
