import { actionCatalog, catalog, QuaiApi } from "@quai/api"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { FlowStore } from "../flows/FlowStore.ts"
import { TestRunner } from "../flows/TestRunner.ts"
import { Hub } from "../integrations/Hub.ts"

export const FlowsHandlers = HttpApiBuilder.group(QuaiApi, "flows", (handlers) =>
  Effect.gen(function*() {
    const store = yield* FlowStore
    const tests = yield* TestRunner
    const hub = yield* Hub
    // A flow turned on or off changes what Quai Home must watch.
    const synced = <A, E>(effect: Effect.Effect<A, E>) => Effect.tap(effect, () => hub.sync)
    const orNotFound = <A>(option: Option.Option<A>) =>
      Option.match(option, { onNone: () => Effect.fail(new HttpApiError.NotFound()), onSome: Effect.succeed })
    return handlers
      .handle("list", () => store.all)
      .handle("catalog", () => Effect.succeed(catalog))
      .handle("actions", () => Effect.succeed(actionCatalog))
      .handle("save", ({ params, payload }) => synced(store.save({ ...payload, id: params.id })))
      .handle("remove", ({ params }) =>
        Effect.flatMap(synced(store.remove(params.id)), (removed) => removed ? Effect.void : Effect.fail(new HttpApiError.NotFound())))
      .handle("reset", ({ params }) => Effect.flatMap(synced(store.reset(params.id)), orNotFound))
      // Every paired iPhone, each with its own preferences for this flow.
      .handle("test", ({ params, payload }) => Effect.flatMap(tests.play(params.id, payload.deviceIds), orNotFound))
  }))
