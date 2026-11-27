import { parseAccessHeaders, PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Config, Effect, Layer, Option } from "effect"

/**
 * This Quai Cloud's public access, from its environment: `QUAI_CLOUD_PUBLIC_URL` and
 * `QUAI_CLOUD_PUBLIC_HEADERS`. Malformed access headers stop the Cloud at startup.
 */
export const PublicAccessLive = Layer.effect(
  PublicAccess,
  Effect.gen(function*() {
    const url = yield* Config.option(Config.String("QUAI_CLOUD_PUBLIC_URL"))
    const text = yield* Config.option(Config.String("QUAI_CLOUD_PUBLIC_HEADERS"))
    const headers = Option.isSome(text) ? yield* parseAccessHeaders(text.value) : []
    if (headers.length > 0) {
      yield* Effect.logInfo(`Access headers for the pairing: ${headers.map((header) => header.name).join(", ")}`)
    }
    return PublicAccess.make(url, headers)
  })
)
