import type { Flow } from "@quai/api"
import { type Activity, activityKey, type Push } from "./Engine.ts"

/** One beat of a test: wait, then push. */
export interface Beat {
  readonly afterMs: number
  readonly push: Push
}

/**
 * A pretend run of a flow, about 30 to 45 s: every step in turn, with fake live values where a
 * step shows them. It goes through the same per-iPhone filtering as real activities.
 */
export const testScript = (flow: Flow, now: number, id: string): ReadonlyArray<Beat> => {
  const subjectKey = `test:${id}`
  let activity: Activity = {
    key: activityKey(flow.id, subjectKey),
    flowId: flow.id,
    subjectKey,
    title: flow.subject === "service" ? "Radarr (test)" : flow.subject === "playback" ? "Big Buck Bunny · TV (test)" : "Big Buck Bunny (test)",
    stepIndex: 0,
    tone: "active",
    values: {},
    downloadId: null,
    enteredAt: now,
    movedAt: now,
    lastEventAt: now,
    endedAt: null,
    pushedAt: now,
    pushedFingerprint: null
  }
  const beats: Array<Beat> = []
  let elapsed = 0
  flow.steps.forEach((step, index) => {
    const last = index === flow.steps.length - 1
    const at = now + elapsed
    activity = {
      ...activity,
      stepIndex: index,
      enteredAt: at,
      endedAt: last ? at : null,
      tone: last ? "done" : "active",
      values: step.show.timer ? { endsAt: at + 40_000, detail: "TV Salon" } : step.show.since ? { since: at, detail: "Not answering" } : {}
    }
    beats.push({ afterMs: index === 0 ? 0 : 5_000, push: { _tag: index === 0 ? "Start" : last ? "End" : "Update", activity } })
    elapsed += 5_000
    if (step.show.progress && !last) {
      for (const p of [0.12, 0.31, 0.52, 0.74, 0.93, 1]) {
        activity = {
          ...activity,
          values: { progress: p, bytesPerSecond: 11_534_336, remainingSeconds: Math.round((1 - p) * 24) }
        }
        beats.push({ afterMs: 4_000, push: { _tag: "Update", activity } })
        elapsed += 4_000
      }
    }
  })
  return beats
}
