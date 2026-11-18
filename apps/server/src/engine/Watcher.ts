import { Context, Effect, Layer, Schedule } from "effect"
import { StateStore } from "../store/StateStore.ts"
import { Notifier } from "../push/Notifier.ts"
import type { AvailabilityCheck } from "../stack/Availability.ts"
import { Jellyfin } from "../stack/Jellyfin.ts"
import { QBittorrent } from "../stack/QBittorrent.ts"
import { DownloadActivities } from "./DownloadActivities.ts"
import type { MediaEvent } from "./Events.ts"

/** How often running activities are refreshed: the push budget allows one update per 15 s. */
export const pollEvery = "15 seconds"

/**
 * Feeds the engine: events from webhooks, and while activities run, torrent progress from
 * qBittorrent and availability from Jellyfin. Nothing is polled when nothing is running.
 */
export class Watcher extends Context.Service<Watcher, {
  readonly handle: (events: ReadonlyArray<MediaEvent>, check: AvailabilityCheck | null) => Effect.Effect<void>
  /** One polling round; the layer runs it every 15 s. */
  readonly poll: Effect.Effect<void>
}>()("quai/Watcher") {
  static readonly make = Effect.gen(function*() {
    const engine = yield* DownloadActivities
    const notifier = yield* Notifier
    const qbittorrent = yield* QBittorrent
    const jellyfin = yield* Jellyfin
    const store = yield* StateStore
    // What to look for in Jellyfin, per activity; saved so an import awaited before a restart still ends.
    const stored = yield* store.load("availability-checks")
    const checks = new Map<string, AvailabilityCheck>(
      Array.isArray(stored) ? (stored as ReadonlyArray<AvailabilityCheck>).map((c) => [c.mediaKey, c]) : []
    )
    const saveChecks = store.save("availability-checks", [...checks.values()])

    const apply = (event: MediaEvent) => Effect.flatMap(engine.handle(event), notifier.send)

    const handle = (events: ReadonlyArray<MediaEvent>, check: AvailabilityCheck | null) =>
      Effect.gen(function*() {
        if (check !== null) {
          checks.set(check.mediaKey, check)
          yield* saveChecks
        }
        yield* Effect.forEach(events, apply, { discard: true })
      })

    const poll = Effect.gen(function*() {
      const { activities } = yield* engine.snapshot
      const running = [...activities.values()]

      const hashes = running.flatMap((a) =>
        a.content.step === "downloading" && a.downloadId !== null ? [a.downloadId] : []
      )
      if (hashes.length > 0) {
        yield* qbittorrent.progress(hashes).pipe(
          Effect.flatMap((events) => Effect.forEach(events, apply, { discard: true })),
          Effect.catchTag("StackError", (e) => Effect.logWarning(`qBittorrent: ${e.message}`))
        )
      }

      for (const activity of running) {
        if (activity.content.step !== "importing") continue
        const check = checks.get(activity.attributes.mediaKey)
        if (check === undefined) continue
        yield* jellyfin.find(check).pipe(
          Effect.flatMap((itemId) =>
            itemId === null ? Effect.void : apply({ _tag: "Available", mediaKey: check.mediaKey })
          ),
          Effect.catchTag("StackError", (e) => Effect.logWarning(`Jellyfin: ${e.message}`))
        )
      }

      const stale = [...checks.keys()].filter((key) => !activities.has(key))
      if (stale.length > 0) {
        for (const key of stale) checks.delete(key)
        yield* saveChecks
      }
      yield* Effect.flatMap(engine.tick, notifier.send)
    })

    return { handle, poll }
  })

  static readonly layer = Layer.effect(
    Watcher,
    Effect.gen(function*() {
      const watcher = yield* Watcher.make
      yield* watcher.poll.pipe(
        Effect.catchCause((cause) => Effect.logError("polling round failed", cause)),
        Effect.repeat(Schedule.spaced(pollEvery)),
        Effect.forkScoped
      )
      return watcher
    })
  )
}
