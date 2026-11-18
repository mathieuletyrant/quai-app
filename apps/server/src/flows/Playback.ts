import type { FlowEvent } from "./Events.ts"
import type { Playing } from "../stack/Jellyfin.ts"

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
      ? { detail: `Paused · ${p.device}` }
      : { detail: p.device, ...(p.remainingMs === null ? {} : { endsAt: nowMs + p.remainingMs }) }
    events.push({ type: before.has(p.key) ? "playback.progress" : "playback.started", subject, values })
  }
  for (const [key, p] of before) {
    if (!seen.has(key)) {
      events.push({ type: "playback.stopped", subject: { kind: "playback", key, title: p.title, device: p.device } })
    }
  }
  return events
}
