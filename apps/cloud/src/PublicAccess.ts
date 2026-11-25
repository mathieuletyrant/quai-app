import type { ConnectionSettings } from "@quai/api"
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect"

/** A header a reverse proxy in front of Quai Cloud requires: the value is a secret. */
export interface AccessHeader {
  readonly name: string
  readonly value: Redacted.Redacted<string>
}

/** `QUAI_CLOUD_PUBLIC_HEADERS` can't be used: the message names the entry, never a value. */
export class InvalidAccessHeaders extends Data.TaggedError("InvalidAccessHeaders")<{
  readonly message: string
}> {}

/** RFC 7230 `token`: what a header name may be made of. */
const tokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** Visible ASCII, spaces and tabs: no line breaks, nothing a proxy would refuse. */
const valuePattern = /^[\t\x20-\x7E]+$/

/**
 * Headers the app or the HTTP stack owns, or that would break the request: the device token is
 * `Authorization: Bearer`, URLSession refuses the reserved ones, and hop-by-hop headers never
 * reach the proxy as sent.
 */
const reserved = new Set([
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
  "www-authenticate",
  "host",
  "content-type",
  "content-length",
  "cookie",
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "expect"
])

/**
 * Reads `QUAI_CLOUD_PUBLIC_HEADERS`: `Name: value` pairs separated by `;` or line breaks, e.g.
 * `CF-Access-Client-Id: abc.access; CF-Access-Client-Secret: def`. A value can't hold a `;`.
 */
export const parseAccessHeaders = (text: string): Effect.Effect<ReadonlyArray<AccessHeader>, InvalidAccessHeaders> =>
  Effect.gen(function*() {
    const fail = (message: string) => Effect.fail(new InvalidAccessHeaders({ message: `QUAI_CLOUD_PUBLIC_HEADERS: ${message}` }))
    const entries = text.split(/[;\r\n]/).map((entry) => entry.trim()).filter((entry) => entry !== "")
    const headers: Array<AccessHeader> = []
    const seen = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      const colon = entry.indexOf(":")
      if (colon === -1) return yield* fail(`entry ${index + 1} isn't "Name: value"`)
      const name = entry.slice(0, colon).trim()
      const value = entry.slice(colon + 1).trim()
      if (!tokenPattern.test(name)) return yield* fail(`entry ${index + 1} has no valid header name`)
      if (reserved.has(name.toLowerCase())) return yield* fail(`${name} can't be set: Quai or HTTP itself sets it`)
      if (seen.has(name.toLowerCase())) return yield* fail(`${name} is given twice`)
      if (!valuePattern.test(value)) return yield* fail(`${name} has an empty value or one with characters a header can't carry`)
      seen.add(name.toLowerCase())
      headers.push({ name, value: Redacted.make(value) })
    }
    return headers
  })

/**
 * How the app reaches this Quai Cloud from outside: `QUAI_CLOUD_PUBLIC_URL`, and the access
 * headers a reverse proxy in front of it requires (`QUAI_CLOUD_PUBLIC_HEADERS`). Both go into the
 * pairing QR code. Quai Home's console has its own, `QUAI_CONSOLE_PUBLIC_URL`, set on Quai Home.
 */
export class PublicAccess extends Context.Service<PublicAccess, {
  readonly url: Option.Option<string>
  readonly headers: ReadonlyArray<AccessHeader>
  /** What the console shows: the header names, never their values. */
  readonly settings: ConnectionSettings
}>()("quai/PublicAccess") {
  static readonly make = (url: Option.Option<string>, headers: ReadonlyArray<AccessHeader>) =>
  ({
    url,
    headers,
    settings: {
      ...Option.match(url, { onNone: () => ({}), onSome: (publicUrl) => ({ publicUrl }) }),
      accessHeaderNames: headers.map((header) => header.name)
    }
  })

  /** From the environment. Malformed access headers stop the Cloud at startup. */
  static readonly layer = Layer.effect(
    PublicAccess,
    Effect.gen(function*() {
      const url = yield* Config.option(Config.String("QUAI_CLOUD_PUBLIC_URL"))
      const text = yield* Config.option(Config.String("QUAI_CLOUD_PUBLIC_HEADERS"))
      const headers = Option.isSome(text) ? yield* parseAccessHeaders(text.value) : []
      if (headers.length > 0) yield* Effect.logInfo(`Access headers for the pairing: ${headers.map((header) => header.name).join(", ")}`)
      return PublicAccess.make(url, headers)
    })
  )
}
