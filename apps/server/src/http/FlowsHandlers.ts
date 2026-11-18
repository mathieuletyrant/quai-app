import { actionCatalog, catalog, QuaiApi } from "@quai/api"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { FlowStore } from "../flows/FlowStore.ts"
import { TestRunner } from "../flows/TestRunner.ts"

export const FlowsHandlers = HttpApiBuilder.group(QuaiApi, "flows", (handlers) =>
  Effect.gen(function*() {
    const store = yield* FlowStore
    const tests = yield* TestRunner
    const orNotFound = <A>(o: Option.Option<A>) =>
      Option.match(o, { onNone: () => Effect.fail(new HttpApiError.NotFound()), onSome: Effect.succeed })
    return handlers
      .handle("list", () => store.all)
      .handle("catalog", () => Effect.succeed(catalog))
      .handle("actions", () => Effect.succeed(actionCatalog))
      .handle("save", ({ params, payload }) => store.save({ ...payload, id: params.id }))
      .handle("remove", ({ params }) =>
        Effect.flatMap(store.remove(params.id), (removed) => removed ? Effect.void : Effect.fail(new HttpApiError.NotFound())))
      .handle("reset", ({ params }) => Effect.flatMap(store.reset(params.id), orNotFound))
      // Every paired iPhone, each with its own preferences for this flow.
      .handle("test", ({ params }) => Effect.flatMap(tests.play(params.id, null), orNotFound))
  }))
