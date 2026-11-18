import { type ActionType, InvalidAction } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpApiError } from "effect/http-api"
import type { PlaybackCommand } from "../stack/Jellyfin.ts"
import { Jellyfin } from "../stack/Jellyfin.ts"
import { Activities } from "./Activities.ts"
import { FlowStore } from "./FlowStore.ts"
import { sessionOf } from "./Playback.ts"
import { Watcher } from "./Watcher.ts"

const playbackCommands: Record<ActionType, PlaybackCommand> = {
  "playback.playPause": "PlayPause",
  "playback.stop": "Stop"
}

/**
 * Runs a button pressed on a Live Activity: checks the activity's current step offers it, sends
 * it to the service, then refreshes at once so the new state reaches the iPhone in a second.
 */
export class ActionRunner extends Context.Service<ActionRunner, {
  readonly run: (key: string, action: ActionType) => Effect.Effect<void, InvalidAction | HttpApiError.NotFound>
}>()("quai/ActionRunner") {
  static readonly layer = Layer.effect(
    ActionRunner,
    Effect.gen(function*() {
      const activities = yield* Activities
      const flows = yield* FlowStore
      const jellyfin = yield* Jellyfin
      const watcher = yield* Watcher
      return {
        run: (key, action) =>
          Effect.gen(function*() {
            const activity = (yield* activities.snapshot).activities.get(key)
            if (activity === undefined || activity.endedAt !== null) return yield* Effect.fail(new HttpApiError.NotFound())
            const flow = (yield* flows.all).find((f) => f.id === activity.flowId)
            const offered = flow?.steps[activity.stepIndex]?.actions ?? []
            if (!offered.includes(action)) {
              return yield* Effect.fail(new InvalidAction({ message: "This activity doesn't offer that button now." }))
            }
            const session = sessionOf(activity.subjectKey)
            if (session === null) return yield* Effect.fail(new InvalidAction({ message: "Not a playback." }))
            yield* jellyfin.command(session, playbackCommands[action]).pipe(
              Effect.mapError((e) => new InvalidAction({ message: `Jellyfin: ${e.message}` }))
            )
            yield* watcher.pollPlayback
          })
      }
    })
  )
}
