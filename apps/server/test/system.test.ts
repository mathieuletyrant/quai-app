import { QuaiApi } from "@quai/api"
import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { HttpApiTest } from "effect/http-api"
import { SystemHandlers } from "../src/SystemHandlers.ts"
import { ServerInfo } from "../src/Version.ts"

const TestLayer = SystemHandlers.pipe(
  Layer.provideMerge(Layer.succeed(ServerInfo, { version: "test", startedAt: 0 })),
  Layer.provideMerge(NodeHttpServer.layerTest)
)

describe("system", () => {
  it.effect("health returns the version and uptime", () =>
    Effect.gen(function*() {
      const client = yield* HttpApiTest.groups(QuaiApi, ["system"])
      yield* TestClock.adjust("90 seconds")
      const health = yield* client.system.health()
      expect(health.status).toBe("ok")
      expect(health.version).toBe("test")
      expect(health.uptimeSeconds).toBe(90)
    }).pipe(Effect.provide(TestLayer)))
})
