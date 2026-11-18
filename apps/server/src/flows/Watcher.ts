import { Context, Effect, Layer, Schedule } from "effect"
import { Notifier } from "../push/Notifier.ts"
import type { AvailabilityCheck } from "../stack/Availability.ts"
import { Health } from "../stack/Health.ts"
import { Jellyfin, type Playing } from "../stack/Jellyfin.ts"
import { QBittorrent } from "../stack/QBittorrent.ts"
import { StateStore } from "../store/StateStore.ts"
import { Activities } from "./Activities.ts"
import type { FlowEvent } from "./Events.ts"
import { FlowStore } from "./FlowStore.ts"
import { playbackEvents } from "./Playback.ts"

/** Running activities and playback are refreshed every 15 s, the push budget's pace. */
export const pollEvery = "15 seconds"
/** Health checks run every minute. */
export const healthEvery = "1 minute"

/**
 * Feeds the engine: events from webhooks, and only what enabled flows need from polling —
 * torrent progress while a step shows it, Jellyfin availability after an import, Jellyfin
 * sessions while a playback flow is on, health checks while a service flow is on.
 */
export class Watcher extends Context.Service<Watcher, {
  readonly handle: (events: ReadonlyArray<FlowEvent>, check: AvailabilityCheck | null) => Effect.Effect<void>
  readonly poll: Effect.Effect<void>
  readonly checkHealth: Effect.Effect<void>
}>()("quai/Watcher") {
  static readonly make = Effect.gen(function*() {
    const engine = yield* Activities
    const notifier = yield* Notifier
    const flowStore = yield* FlowStore
    const qbittorrent = yield* QBittorrent
    const jellyfin = yield* Jellyfin
    const health = yield* Health
    const store = yield* StateStore

    // What to look for in Jellyfin, per subject; saved so an import awaited before a restart still ends.
    const stored = yield* store.load("availability-checks")
    const checks = new Map<string, AvailabilityCheck>(
      Array.isArray(stored) ? (stored as ReadonlyArray<AvailabilityCheck>).map((c) => [c.mediaKey, c]) : []
    )
    const saveChecks = store.save("availability-checks", [...checks.values()])
    let playing = new Map<string, Playing>()

    const apply = (event: FlowEvent) => Effect.flatMap(engine.handle(event), notifier.send)

    const handle = (events: ReadonlyArray<FlowEvent>, check: AvailabilityCheck | null) =>
      Effect.gen(function*() {
        if (check !== null) {
          checks.set(check.mediaKey, check)
          yield* saveChecks
        }
        yield* Effect.forEach(events, apply, { discard: true })
      })

    const poll = Effect.gen(function*() {
      const flows = yield* flowStore.all
      const { activities } = yield* engine.snapshot
      const running = [...activities.values()].filter((a) => a.endedAt === null)

      const hashes = running.flatMap((a) => {
        const step = flows.find((f) => f.id === a.flowId)?.steps[a.stepIndex]
        return step?.show.progress === true && a.downloadId !== null ? [a.downloadId] : []
      })
      if (hashes.length > 0) {
        yield* qbittorrent.progress([...new Set(hashes)]).pipe(
          Effect.flatMap((events) => Effect.forEach(events, apply, { discard: true })),
          Effect.catchTag("StackError", (e) => Effect.logWarning(`qBittorrent: ${e.message}`))
        )
      }

      // An import is awaited in Jellyfin while some running activity of that title has a later
      // "Available in Jellyfin" step.
      const awaited = new Set(running.flatMap((a) => {
        const flow = flows.find((f) => f.id === a.flowId)
        const target = flow?.steps.findIndex((s) => s.on === "media.available") ?? -1
        return target > a.stepIndex ? [a.subjectKey] : []
      }))
      for (const subjectKey of awaited) {
        const check = checks.get(subjectKey)
        if (check === undefined) continue
        yield* jellyfin.find(check).pipe(
          Effect.flatMap((itemId) =>
            itemId === null ? Effect.void : apply({
              type: "media.available",
              subject: {
                kind: "media",
                key: check.mediaKey,
                title: check._tag === "Movie" ? check.title : check.title,
                mediaType: check._tag === "Movie" ? "movie" : "series"
              }
            })
          ),
          Effect.catchTag("StackError", (e) => Effect.logWarning(`Jellyfin: ${e.message}`))
        )
      }
      const stale = [...checks.keys()].filter((k) => !running.some((a) => a.subjectKey === k))
      if (stale.length > 0) {
        for (const k of stale) checks.delete(k)
        yield* saveChecks
      }

      if (jellyfin.configured && flows.some((f) => f.enabled && f.subject === "playback")) {
        yield* jellyfin.playing.pipe(
          Effect.flatMap((now) =>
            Effect.gen(function*() {
              const events = playbackEvents(playing, now, Date.now())
              playing = new Map(now.map((p) => [p.key, p]))
              yield* Effect.forEach(events, apply, { discard: true })
            })
          ),
          Effect.catchTag("StackError", (e) => Effect.logWarning(`Jellyfin sessions: ${e.message}`))
        )
      }

      yield* Effect.flatMap(engine.tick, notifier.send)
    })

    const checkHealth = Effect.gen(function*() {
      const flows = yield* flowStore.all
      if (!flows.some((f) => f.enabled && f.subject === "service")) return
      const events = yield* health.check
      yield* Effect.forEach(events, apply, { discard: true })
    })

    return { handle, poll, checkHealth }
  })

  static readonly layer = Layer.effect(
    Watcher,
    Effect.gen(function*() {
      const watcher = yield* Watcher.make
      const forever = (effect: Effect.Effect<void>, every: string, name: string) =>
        effect.pipe(
          Effect.catchCause((cause) => Effect.logError(`${name} failed`, cause)),
          Effect.repeat(Schedule.spaced(every as "15 seconds")),
          Effect.forkScoped
        )
      yield* forever(watcher.poll, pollEvery, "polling round")
      yield* forever(watcher.checkHealth, healthEvery, "health check")
      return watcher
    })
  )
}
