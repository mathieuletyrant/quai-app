import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { DownloadActivities } from "../../src/engine/DownloadActivities.ts"
import { StateStore } from "../../src/store/StateStore.ts"
import * as Database from "../../src/store/Database.ts"

/** One Quai process: a fresh engine on the given store, as after a restart. */
const boot = (store: Context.Context<StateStore>) =>
  Effect.map(Layer.build(DownloadActivities.layerPersisted.pipe(Layer.provide(Layer.succeedContext(store)))), (ctx) =>
    Context.get(ctx, DownloadActivities))

describe("restart", () => {
  it.effect("a running download survives a restart and keeps being updated", () =>
    Effect.gen(function*() {
      const store = yield* Layer.build(StateStore.layer.pipe(Layer.provide(Database.layerFile(":memory:"))))

      const before = yield* boot(store)
      yield* before.handle({ _tag: "Grabbed", mediaKey: "movie:tmdb:1", title: "Dune", downloadId: "abc" })

      // Quai restarts (an update): the new process reads the activity back.
      const after = yield* boot(store)
      const restored = (yield* after.snapshot).activities.get("movie:tmdb:1")
      expect(restored?.content.step).toBe("downloading")
      expect(restored?.downloadId).toBe("abc")

      // Progress for its torrent updates it, instead of being ignored.
      yield* TestClock.adjust("20 seconds")
      const pushes = yield* after.handle({ _tag: "Progress", downloadId: "abc", progress: 0.5, bytesPerSecond: 1, remainingSeconds: 60 })
      expect(pushes.map((p) => p._tag)).toEqual(["Update"])

      // And the import that follows is an update, not a second activity.
      const imported = yield* after.handle({ _tag: "Imported", mediaKey: "movie:tmdb:1", title: "Dune" })
      expect(imported.map((p) => p._tag)).toEqual(["Update"])
    }).pipe(Effect.scoped))
})
