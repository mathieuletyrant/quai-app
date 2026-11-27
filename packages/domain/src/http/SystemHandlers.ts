import { QuaiApi } from "@quai/api"
import { Clock, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ServerInfo } from "../Version.ts"

export const SystemHandlers = HttpApiBuilder.group(QuaiApi, "system", (handlers) =>
  Effect.gen(function*() {
    const info = yield* ServerInfo
    return handlers.handle("health", () =>
      Effect.map(Clock.currentTimeMillis, (now) => ({
        status: "ok" as const,
        version: info.version,
        uptimeSeconds: Math.max(0, Math.floor((now - info.startedAt) / 1000))
      })))
  }))
