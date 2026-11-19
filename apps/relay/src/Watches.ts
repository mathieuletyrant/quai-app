import { RelayProtocol } from "@quai/api"
import { Context, Effect, FiberSet, Layer, type Scope } from "effect"
import { Calls } from "./Calls.ts"

type Send = (message: RelayProtocol.RelayMessage) => Effect.Effect<void>

export interface Watcher {
  /** Replaces every watch. A watch outside the allowlist is answered with `Failed` and skipped. */
  readonly set: (watches: ReadonlyArray<RelayProtocol.Watch>) => Effect.Effect<void>
  /** Stops every watch and forgets what was sent, so the next snapshots all go out. */
  readonly reset: Effect.Effect<void>
}

/**
 * Polls what the Core watches, on the LAN, and sends a snapshot only when it changed. The meaning
 * of a snapshot is the Core's business; the Relay only compares status and body.
 */
export class Watches extends Context.Service<Watches, {
  /** A watcher for one connection: its polls stop when the scope closes. */
  readonly make: (send: Send) => Effect.Effect<Watcher, never, Scope.Scope>
}>()("quai-relay/Watches") {
  static readonly layer = Layer.effect(
    Watches,
    Effect.gen(function*() {
      const calls = yield* Calls
      return {
        make: (send) =>
          Effect.gen(function*() {
            const fibers = yield* FiberSet.make()
            /** The last snapshot sent per watch id, with what it watched. */
            const sent = new Map<string, { readonly target: string; readonly status: number; readonly body: string }>()
            const targetOf = (watch: RelayProtocol.Watch) => `${watch.service} ${watch.path}`

            const poll = (watch: RelayProtocol.Watch) =>
              Effect.gen(function*() {
                let failing = false
                while (true) {
                  const result = yield* calls.run({ _tag: "Call", id: watch.id, service: watch.service, method: "GET", path: watch.path })
                  if (result._tag === "Failed") {
                    // Once per failure streak; the next success sends a snapshot even if unchanged.
                    if (!failing) yield* send(result)
                    failing = true
                    sent.delete(watch.id)
                  } else {
                    failing = false
                    const last = sent.get(watch.id)
                    if (last === undefined || last.status !== result.status || last.body !== result.body) {
                      sent.set(watch.id, { target: targetOf(watch), status: result.status, body: result.body })
                      yield* send(RelayProtocol.WatchSnapshot.make({ watchId: watch.id, status: result.status, body: result.body }))
                    }
                  }
                  yield* Effect.sleep(`${watch.everySeconds} seconds`)
                }
              })

            return {
              reset: Effect.andThen(FiberSet.clear(fibers), Effect.sync(() => sent.clear())),
              set: (watches) =>
                Effect.gen(function*() {
                  yield* FiberSet.clear(fibers)
                  const kept = new Map(watches.map((w) => [w.id, targetOf(w)]))
                  for (const [id, last] of sent) if (kept.get(id) !== last.target) sent.delete(id)
                  for (const watch of watches) {
                    if (!RelayProtocol.allowed({ service: watch.service, method: "GET", path: watch.path })) {
                      yield* send(RelayProtocol.Failed.make({ id: watch.id, reason: "not allowed" }))
                      continue
                    }
                    yield* FiberSet.run(fibers, poll(watch))
                  }
                })
            }
          })
      }
    })
  )
}
