import { QuaiApi } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { HttpApiTest } from "effect/http-api"
import { TestApp } from "./testApp.ts"

describe("system", () => {
  it.effect("health returns the version and uptime", () =>
    Effect.gen(function*() {
      const client = yield* HttpApiTest.groups(QuaiApi, ["system"])
      yield* TestClock.adjust("90 seconds")
      const health = yield* client.system.health()
      expect(health.status).toBe("ok")
      expect(health.version).toBe("test")
      expect(health.uptimeSeconds).toBe(90)
    }).pipe(Effect.provide(TestApp)))
})
