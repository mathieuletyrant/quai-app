import { QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { HttpApiTest } from "effect/http-api"
import { parseAccessHeaders, PublicAccess } from "../src/PublicAccess.ts"
import { connectedHome, TestApp, testAppWith } from "./testApp.ts"

const cloudflare = "CF-Access-Client-Id: abc123.access; CF-Access-Client-Secret: s3cr3t+/=="

const fromEnv = (env: Record<string, string>) =>
  PublicAccess.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))))

const failure = (text: string) =>
  Effect.flip(parseAccessHeaders(text)).pipe(Effect.map((e) => e.message))

describe("QUAI_PUBLIC_HEADERS", () => {
  it.effect("reads Name: value pairs separated by ; or line breaks", () =>
    Effect.gen(function*() {
      const headers = yield* parseAccessHeaders(`${cloudflare};\n X-Token :  a b  \n`)
      expect(headers.map((h) => [h.name, Redacted.value(h.value)])).toEqual([
        ["CF-Access-Client-Id", "abc123.access"],
        ["CF-Access-Client-Secret", "s3cr3t+/=="],
        ["X-Token", "a b"]
      ])
      expect(yield* parseAccessHeaders(" ; \n")).toEqual([])
    }))

  it.effect("refuses what isn't a header, and the headers Quai or HTTP own", () =>
    Effect.gen(function*() {
      expect(yield* failure("X-Token abc")).toBe(`QUAI_PUBLIC_HEADERS: entry 1 isn't "Name: value"`)
      expect(yield* failure("X-Ok: 1; Bad Name: 1")).toBe("QUAI_PUBLIC_HEADERS: entry 2 has no valid header name")
      expect(yield* failure(": 1")).toBe("QUAI_PUBLIC_HEADERS: entry 1 has no valid header name")
      for (const name of ["Authorization", "host", "Content-Type", "Content-Length", "Cookie", "Connection", "Transfer-Encoding", "Upgrade"]) {
        expect(yield* failure(`${name}: x`)).toBe(`QUAI_PUBLIC_HEADERS: ${name} can't be set: Quai or HTTP itself sets it`)
      }
      expect(yield* failure("X-Token: a; x-token: b")).toBe("QUAI_PUBLIC_HEADERS: x-token is given twice")
      expect(yield* failure("X-Token:")).toBe("QUAI_PUBLIC_HEADERS: X-Token has an empty value or one with characters a header can't carry")
      expect(yield* failure("X-Token: café")).toBe("QUAI_PUBLIC_HEADERS: X-Token has an empty value or one with characters a header can't carry")
    }))

  it.effect("never puts a value in an error", () =>
    Effect.gen(function*() {
      expect(yield* failure("X-Token: hunter2 é")).not.toContain("hunter2")
      expect(yield* failure("hunter2")).not.toContain("hunter2")
    }))

  it.effect("a malformed value stops the Cloud at startup", () =>
    Effect.gen(function*() {
      const started = Effect.gen(function*() { return yield* PublicAccess })
      const error = yield* Effect.flip(Effect.provide(started, fromEnv({ QUAI_PUBLIC_HEADERS: "Host: evil" })))
      expect(error._tag).toBe("InvalidAccessHeaders")
    }))
})

describe("public access", () => {
  const configured = testAppWith(fromEnv({ QUAI_PUBLIC_URL: "https://quai.example.com", QUAI_PUBLIC_HEADERS: cloudflare }))

  it.effect("the QR code carries the public address and the access headers; the console sees their names", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "connection"])
      const qr = yield* api.console.createPairingCode({ payload: { serverUrls: ["http://umbrel.local:3078"] } })
      expect(qr.link).toBe(
        `quai://pair?code=${qr.code}&url=http%3A%2F%2Fumbrel.local%3A3078&url=https%3A%2F%2Fquai.example.com` +
          "&header=CF-Access-Client-Id%3A%20abc123.access&header=CF-Access-Client-Secret%3A%20s3cr3t%2B%2F%3D%3D"
      )
      expect(qr.accessHeaderNames).toEqual(["CF-Access-Client-Id", "CF-Access-Client-Secret"])
      expect(yield* api.connection.connectionSettings()).toEqual({
        publicUrl: "https://quai.example.com",
        accessHeaderNames: ["CF-Access-Client-Id", "CF-Access-Client-Secret"]
      })
    }).pipe(Effect.provide(configured)))

  it.effect("without them, the QR code is what older apps already read", () =>
    Effect.gen(function*() {
      yield* connectedHome
      const api = yield* HttpApiTest.groups(QuaiApi, ["console", "connection"])
      const qr = yield* api.console.createPairingCode({ payload: { serverUrls: [] } })
      expect(qr.link).toBe(`quai://pair?code=${qr.code}`)
      expect(qr.accessHeaderNames).toEqual([])
      expect(yield* api.connection.connectionSettings()).toEqual({ accessHeaderNames: [] })
    }).pipe(Effect.provide(TestApp)))
})
