import { type HomeEvent, maxWatchSeconds, minWatchSeconds, type Watch } from "@quai/domain/home/HomeLink.ts"
import { Context, Effect, FiberSet, Layer, type Scope } from "effect"
import { Calls } from "./Calls.ts"

/** What the watches tell the domain: a snapshot that changed, or why a watch can't be read. */
export type WatchEvent = Extract<HomeEvent, { readonly _tag: "Snapshot" | "WatchFailed" }>

type Send = (event: WatchEvent) => Effect.Effect<unknown>

export interface Watcher {
  /** Replaces every watch. A watch whose period is out of range is answered `WatchFailed` and skipped. */
  readonly set: (watches: ReadonlyArray<Watch>) => Effect.Effect<void>
  /** Stops every watch and forgets what was sent, so the next snapshots all go out. */
  readonly reset: Effect.Effect<void>
}

/**
 * Polls what Quai watches, on the LAN, and sends a snapshot only when it changed. The meaning
 * of a snapshot is its integration's business; this only compares status and body.
 */
export class Watches extends Context.Service<Watches, {
  /** A watcher: its polls stop when the scope closes. */
  readonly make: (send: Send) => Effect.Effect<Watcher, never, Scope.Scope>
}>()("quai-home/Watches") {
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
            const targetOf = (watch: Watch) => `${watch.service} ${watch.path}`

            const poll = (watch: Watch) =>
              Effect.gen(function*() {
                let failing = false
                while (true) {
                  const result = yield* calls.run({ service: watch.service, method: "GET", path: watch.path })
                  if (result._tag === "Failed") {
                    // Once per failure streak; the next success sends a snapshot even if unchanged.
                    if (!failing) yield* send({ _tag: "WatchFailed", watchId: watch.id, reason: result.reason })
                    failing = true
                    sent.delete(watch.id)
                  } else {
                    failing = false
                    const last = sent.get(watch.id)
                    if (last === undefined || last.status !== result.status || last.body !== result.body) {
                      sent.set(watch.id, { target: targetOf(watch), status: result.status, body: result.body })
                      yield* send({ _tag: "Snapshot", watchId: watch.id, status: result.status, body: result.body })
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
                  const kept = new Map(watches.map((watch) => [watch.id, targetOf(watch)]))
                  for (const [id, last] of sent) if (kept.get(id) !== last.target) sent.delete(id)
                  for (const watch of watches) {
                    if (!(watch.everySeconds >= minWatchSeconds && watch.everySeconds <= maxWatchSeconds)) {
                      yield* send({ _tag: "WatchFailed", watchId: watch.id, reason: "period out of range" })
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
