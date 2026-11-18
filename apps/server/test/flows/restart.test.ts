import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Activities } from "../../src/flows/Activities.ts"
import * as Database from "../../src/store/Database.ts"
import { StateStore } from "../../src/store/StateStore.ts"
import { ev, fixedFlows } from "./helpers.ts"

/** One Quai process: a fresh engine on the given store, as after a restart. */
const boot = (store: Context.Context<StateStore>) =>
  Effect.map(
    Layer.build(Activities.layerPersisted.pipe(Layer.provide([Layer.succeedContext(store), fixedFlows()]))),
    (ctx) => Context.get(ctx, Activities)
  )

describe("restart", () => {
  it.effect("a running download survives a restart and keeps being updated", () =>
    Effect.gen(function*() {
      const store = yield* Layer.build(StateStore.layer.pipe(Layer.provide(Database.layerFile(":memory:"))))
      yield* (yield* boot(store)).handle(ev.grabbed())

      const after = yield* boot(store)
      const restored = [...(yield* after.snapshot).activities.values()][0]
      expect(restored?.stepIndex).toBe(1)
      expect(restored?.downloadId).toBe("abc")

      yield* TestClock.adjust("20 seconds")
      expect((yield* after.handle(ev.progress(0.5))).map((p) => p._tag)).toEqual(["Update"])
      expect((yield* after.handle(ev.imported())).map((p) => p._tag)).toEqual(["Update"])
    }).pipe(Effect.scoped))
})
