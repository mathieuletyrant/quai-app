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
    lookup: null,
    enteredAt: now,
    movedAt: now,
    lastEventAt: now,
    endedAt: null,
    pushedAt: now,
    pushedFingerprint: null
  }
  const beats: Array<Beat> = []
  let clock = now
  const beat = (afterMs: number, tag: Push["_tag"], change: Partial<Activity>) => {
    clock += afterMs
    activity = { ...activity, ...change }
    beats.push({ afterMs, push: { _tag: tag, activity } })
  }

  flow.steps.forEach((step, index) => {
    const ends = flow.endOn === undefined && index === flow.steps.length - 1
    const at = clock + (index === 0 ? 0 : 5_000)
    const values = step.show.timer
      ? { paused: false, startsAt: at, endsAt: at + 40_000, detail: "TV Salon" }
      : step.show.since
      ? { since: at, detail: "Not answering" }
      : {}
    beat(index === 0 ? 0 : 5_000, index === 0 ? "Start" : ends ? "End" : "Update", {
      stepIndex: index,
      enteredAt: at,
      endedAt: ends ? at : null,
      tone: ends ? "done" : "active",
      values
    })
    if (step.show.progress && !ends) {
      for (const p of [0.12, 0.31, 0.52, 0.74, 0.93, 1]) {
        beat(4_000, "Update", { values: { progress: p, bytesPerSecond: 11_534_336, remainingSeconds: Math.round((1 - p) * 24) } })
      }
    }
    if (step.actions?.includes("playback.playPause")) {
      // Shows the button's two states: a pause, then playing again from where it was.
      beat(8_000, "Update", { values: { paused: true, progress: 0.2, detail: "TV Salon" } })
      beat(5_000, "Update", { values: { paused: false, startsAt: clock + 5_000 - 8_000, endsAt: clock + 5_000 + 32_000, detail: "TV Salon" } })
    }
  })
  if (activity.endedAt === null) beat(8_000, "End", { endedAt: clock + 8_000, tone: "done" })
  return beats
}
