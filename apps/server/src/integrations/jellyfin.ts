import { type ActionType, InvalidAction } from "@quai/api"
import { Clock, Effect } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent } from "../flows/Events.ts"
import { Jellyfin, type PlaybackCommand, type Playing } from "../stack/Jellyfin.ts"
import { anyEnabledFlow, type ActionHandler, type Integration, type PollContext, runningWhere } from "./Integration.ts"

/**
 * Turns two successive snapshots of Jellyfin's sessions into playback events: new items started,
 * the ones still there moved on, the ones gone stopped.
 */
export const playbackEvents = (
  before: ReadonlyMap<string, Playing>,
  now: ReadonlyArray<Playing>,
  nowMs: number
): ReadonlyArray<FlowEvent> => {
  const events: Array<FlowEvent> = []
  const seen = new Set<string>()
  for (const p of now) {
    seen.add(p.key)
    const subject = { kind: "playback" as const, key: p.key, title: p.title, device: p.device }
    const values = p.paused
      ? {
        paused: true,
        detail: p.device,
        ...(p.runtimeMs === null || p.runtimeMs === 0 ? {} : { progress: p.positionMs / p.runtimeMs })
      }
      : {
        paused: false,
        detail: p.device,
        ...(p.remainingMs === null ? {} : { endsAt: nowMs + p.remainingMs, startsAt: nowMs - p.positionMs })
      }
    events.push({ type: before.has(p.key) ? "playback.progress" : "playback.started", subject, values })
  }
  for (const [key, p] of before) {
    if (!seen.has(key)) {
      events.push({ type: "playback.stopped", subject: { kind: "playback", key, title: p.title, device: p.device } })
    }
  }
  return events
}

/** The Jellyfin session a playback subject belongs to (`playback:<session>:<item>`). */
export const sessionOf = (subjectKey: string): string | null => {
  const [kind, session] = subjectKey.split(":")
  return kind === "playback" && session !== undefined && session !== "" ? session : null
}

/** Running activities waiting for "Available in Jellyfin", with a lookup to search it by. */
const awaitingAvailability = (context: PollContext): ReadonlyArray<Activity> =>
  runningWhere(context, (a, flow) => {
    const target = flow.steps.findIndex((s) => s.on === "media.available")
    return a.lookup !== null && target > a.stepIndex
  })

/**
 * Jellyfin doesn't push to Quai: it is asked every 15 s whether imported titles are available
 * (while some activity awaits it) and what plays (while a playback flow is on). Its remote
 * control runs the playback buttons.
 */
export const jellyfin = Effect.gen(function*() {
  const client = yield* Jellyfin
  // What played at the last poll, to tell started, moved and stopped apart.
  let playing = new Map<string, Playing>()
  const warn = (what: string) => (e: { readonly message: string }) =>
    Effect.as(Effect.logWarning(`Jellyfin ${what}: ${e.message}`), [] as ReadonlyArray<FlowEvent>)

  const command = (name: PlaybackCommand): ActionHandler => (activity) => {
    const session = sessionOf(activity.subjectKey)
    if (session === null) return Effect.fail(new InvalidAction({ message: "Not a playback." }))
    return client.command(session, name).pipe(Effect.mapError((e) => new InvalidAction({ message: `Jellyfin: ${e.message}` })))
  }

  const actions: Partial<Record<ActionType, ActionHandler>> = {
    "playback.playPause": command("PlayPause"),
    "playback.stop": command("Stop")
  }

  const integration: Integration = {
    service: "jellyfin",
    pollers: [
      {
        name: "availability",
        every: "15 seconds",
        needed: (context) => client.configured && awaitingAvailability(context).length > 0,
        run: (context) =>
          Effect.forEach(awaitingAvailability(context), (activity) =>
            client.find(activity.lookup!).pipe(
              Effect.map((itemId): ReadonlyArray<FlowEvent> =>
                itemId === null ? [] : [{
                  type: "media.available",
                  subject: {
                    kind: "media",
                    key: activity.subjectKey,
                    title: activity.title,
                    mediaType: activity.lookup!._tag === "Movie" ? "movie" : "series"
                  }
                }]
              ),
              Effect.catchTag("StackError", warn("availability"))
            )).pipe(Effect.map((all) => all.flat()))
      },
      {
        name: "playback",
        every: "15 seconds",
        needed: (context) => client.configured && anyEnabledFlow(context, "playback"),
        run: () =>
          client.playing.pipe(
            Effect.flatMap((now) =>
              Effect.map(Clock.currentTimeMillis, (ms) => {
                const events = playbackEvents(playing, now, ms)
                playing = new Map(now.map((p) => [p.key, p]))
                return events
              })
            ),
            Effect.catchTag("StackError", warn("sessions"))
          )
      }
    ],
    actions
  }
  return integration
})
