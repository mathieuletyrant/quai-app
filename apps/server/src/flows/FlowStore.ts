import { builtInFlows, type Flow, Flow as FlowSchema, flowProblem, InvalidFlow } from "@quai/api"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { SqlClient } from "effect/sql"

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(FlowSchema))

/**
 * The flows in force: built-in ones (as shipped, or as edited) and custom ones. Kept in memory for
 * the engine, written through to SQLite.
 */
export class FlowStore extends Context.Service<FlowStore, {
  readonly all: Effect.Effect<ReadonlyArray<Flow>>
  readonly get: (id: string) => Effect.Effect<Option.Option<Flow>>
  readonly save: (flow: Flow) => Effect.Effect<Flow, InvalidFlow>
  readonly remove: (id: string) => Effect.Effect<boolean, InvalidFlow>
  /** Back to the shipped version of a built-in flow. */
  readonly reset: (id: string) => Effect.Effect<Option.Option<Flow>>
}>()("quai/FlowStore") {
  static readonly layer = Layer.effect(
    FlowStore,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const load = Effect.gen(function*() {
        const rows = yield* sql`SELECT id, definition FROM flows`
        const stored = new Map<string, Flow>()
        for (const row of rows) {
          const flow = decode(row["definition"])
          if (Option.isSome(flow)) stored.set(String(row["id"]), flow.value)
        }
        const builtIn = builtInFlows.map((f) => stored.get(f.id) ?? f)
        const custom = [...stored.values()].filter((f) => !builtInFlows.some((b) => b.id === f.id))
        return [...builtIn, ...custom]
      }).pipe(Effect.orDie)
      const cache = yield* Ref.make(yield* load)
      const refresh = Effect.flatMap(load, (flows) => Ref.set(cache, flows))

      return {
        all: Ref.get(cache),
        get: (id) => Effect.map(Ref.get(cache), (flows) => Option.fromNullishOr(flows.find((f) => f.id === id))),
        save: (input) =>
          Effect.gen(function*() {
            const flow: Flow = { ...input, builtIn: builtInFlows.some((b) => b.id === input.id) }
            const problem = flowProblem(flow)
            if (problem !== null) return yield* Effect.fail(new InvalidFlow({ message: problem }))
            yield* sql`INSERT INTO flows (id, definition) VALUES (${flow.id}, ${JSON.stringify(flow)})
              ON CONFLICT (id) DO UPDATE SET definition = excluded.definition`.pipe(Effect.orDie)
            yield* refresh
            return flow
          }),
        remove: (id) =>
          Effect.gen(function*() {
            if (builtInFlows.some((b) => b.id === id)) {
              return yield* Effect.fail(new InvalidFlow({ message: "Built-in flows can't be deleted: turn them off instead." }))
            }
            const removed = yield* sql`DELETE FROM flows WHERE id = ${id} RETURNING id`.pipe(Effect.orDie)
            yield* refresh
            return removed.length > 0
          }),
        reset: (id) =>
          Effect.gen(function*() {
            const shipped = builtInFlows.find((b) => b.id === id)
            if (shipped === undefined) return Option.none()
            yield* sql`DELETE FROM flows WHERE id = ${id}`.pipe(Effect.orDie)
            yield* refresh
            return Option.some(shipped)
          })
      }
    })
  )
}
