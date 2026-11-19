import { builtInFlows, type Flow, Flow as FlowSchema, flowProblem, type HomeOffline, HomeProtocol, InvalidFlow } from "@quai/api"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HomeDocuments, toOffline } from "../home/HomeLink.ts"

const decode = Schema.decodeUnknownOption(FlowSchema)

/** `flows/<id>`: a built-in flow as edited, or a custom flow. A built-in flow left as shipped has none. */
export const flowKey = (id: string) => `flows/${id}`

/**
 * The flows in force: built-in ones (as shipped, or as edited) and custom ones, kept as home
 * documents.
 */
export class FlowStore extends Context.Service<FlowStore, {
  readonly all: Effect.Effect<ReadonlyArray<Flow>, HomeOffline>
  readonly get: (id: string) => Effect.Effect<Option.Option<Flow>, HomeOffline>
  readonly save: (flow: Flow) => Effect.Effect<Flow, InvalidFlow | HomeOffline>
  readonly remove: (id: string) => Effect.Effect<boolean, InvalidFlow | HomeOffline>
  /** Back to the shipped version of a built-in flow. */
  readonly reset: (id: string) => Effect.Effect<Option.Option<Flow>, HomeOffline>
}>()("quai/FlowStore") {
  static readonly layer = Layer.effect(
    FlowStore,
    Effect.gen(function*() {
      const store = yield* HomeDocuments
      const isBuiltIn = (id: string) => builtInFlows.some((b) => b.id === id)
      const all = Effect.gen(function*() {
        const stored = new Map<string, Flow>()
        for (const doc of yield* store.list("flows/")) {
          const flow = decode(doc.value)
          if (Option.isSome(flow)) stored.set(flow.value.id, flow.value)
        }
        const builtIn = builtInFlows.map((f) => stored.get(f.id) ?? f)
        const custom = [...stored.values()].filter((f) => !isBuiltIn(f.id))
        return [...builtIn, ...custom]
      }).pipe(Effect.mapError(toOffline))

      return {
        all,
        get: (id) => Effect.map(all, (flows) => Option.fromNullishOr(flows.find((f) => f.id === id))),
        save: (input) =>
          Effect.gen(function*() {
            const flow: Flow = { ...input, builtIn: isBuiltIn(input.id) }
            if (!HomeProtocol.isStoreKey(flowKey(flow.id))) {
              return yield* Effect.fail(new InvalidFlow({ message: "A flow id is lowercase letters, digits, dots, dashes or underscores." }))
            }
            const problem = flowProblem(flow)
            if (problem !== null) return yield* Effect.fail(new InvalidFlow({ message: problem }))
            yield* Effect.mapError(store.put(flowKey(flow.id), flow), toOffline)
            return flow
          }),
        remove: (id) =>
          Effect.gen(function*() {
            if (isBuiltIn(id)) {
              return yield* Effect.fail(new InvalidFlow({ message: "Built-in flows can't be deleted: turn them off instead." }))
            }
            if (!HomeProtocol.isStoreKey(flowKey(id))) return false
            const existing = yield* Effect.mapError(store.get(flowKey(id)), toOffline)
            if (Option.isNone(existing)) return false
            yield* Effect.mapError(store.delete(flowKey(id)), toOffline)
            return true
          }),
        reset: (id) =>
          Effect.gen(function*() {
            const shipped = builtInFlows.find((b) => b.id === id)
            if (shipped === undefined) return Option.none()
            yield* Effect.mapError(store.delete(flowKey(id)), toOffline)
            return Option.some(shipped)
          })
      }
    })
  )
}
