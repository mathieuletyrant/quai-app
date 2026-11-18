import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { readFileSync } from "node:fs"
import { Health } from "../src/index.ts"
import { openApiJson } from "../src/openapi.ts"

describe("contrat", () => {
  it.effect("Health décode et ré-encode sans perte", () =>
    Effect.gen(function*() {
      const input = { status: "ok", version: "0.0.0", uptimeSeconds: 12 }
      const decoded = yield* Schema.decodeUnknownEffect(Health)(input)
      const encoded = yield* Schema.encodeEffect(Health)(decoded)
      expect(encoded).toEqual(input)
    }))

  it("openapi.json est à jour (sinon : pnpm gen:openapi)", () => {
    const committed = readFileSync(new URL("../openapi.json", import.meta.url), "utf8")
    expect(openApiJson()).toBe(committed)
  })
})
