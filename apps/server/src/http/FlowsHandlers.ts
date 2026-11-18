import { catalog, QuaiApi } from "@quai/api"
import { Clock, Duration, Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { FlowStore } from "../flows/FlowStore.ts"
import { testScript } from "../flows/TestScript.ts"
import { Notifier } from "../push/Notifier.ts"

export const FlowsHandlers = HttpApiBuilder.group(QuaiApi, "flows", (handlers) =>
  Effect.gen(function*() {
    const store = yield* FlowStore
    const notifier = yield* Notifier
    const orNotFound = <A>(o: Option.Option<A>) =>
      Option.match(o, { onNone: () => Effect.fail(new HttpApiError.NotFound()), onSome: Effect.succeed })
    return handlers
      .handle("list", () => store.all)
      .handle("catalog", () => Effect.succeed(catalog))
      .handle("save", ({ params, payload }) => store.save({ ...payload, id: params.id }))
      .handle("remove", ({ params }) =>
        Effect.flatMap(store.remove(params.id), (removed) => removed ? Effect.void : Effect.fail(new HttpApiError.NotFound())))
      .handle("reset", ({ params }) => Effect.flatMap(store.reset(params.id), orNotFound))
      .handle("test", ({ params }) =>
        Effect.gen(function*() {
          const flow = yield* Effect.flatMap(store.get(params.id), orNotFound)
          const now = yield* Clock.currentTimeMillis
          // Every paired iPhone, each with its own preferences for this flow.
          yield* Effect.forEach(testScript(flow, now, `console:${now}`), (beat) =>
            Effect.andThen(Effect.sleep(Duration.millis(beat.afterMs)), notifier.sendTo(null, [beat.push])), {
            discard: true
          }).pipe(Effect.forkDetach)
        }))
  }))
