import type { ActivityItem, Flow } from "@quai/api"
import { type Activity, activityKey, endsAtStep, type Push } from "./Engine.ts"
import type { Values } from "./Events.ts"

/** One beat of a test: wait, then push. */
export interface Beat {
  readonly afterMs: number
  readonly push: Push
}

/**
 * A pretend run of a flow, about 30 to 45 s: every step in turn, with fake live values where a
 * step shows them. It goes through the same per-iPhone filtering as real activities.
 */
const titles: Record<Flow["subject"], string> = {
  media: "Big Buck Bunny (test)",
  playback: "Big Buck Bunny · TV (test)",
  request: "Big Buck Bunny (test)",
  day: "Today (test)"
}

/** Sample lines of a list, `done` of them here: today's releases, airing from `at`. */
const sampleItems = (at: number, done: number): Values => {
  const titles = ["Big Buck Bunny S01E01", "Sintel S01E02", "Tears of Steel", "Elephants Dream S02E01"]
  const items = titles.map((title, index): ActivityItem => ({
    title,
    ...(index < 3 ? { at: Math.floor(at / 1000) + 3600 * (index + 1) } : {}),
    state: index < done ? "done" : index === done ? "active" : "waiting"
  }))
  return { items, here: done, total: titles.length, detail: `${done} of ${titles.length} here` }
}

/** What a step shows in the test, with values like a real run's. */
const sampleValues = (flow: Flow, step: Flow["steps"][number], at: number, last: boolean): Values =>
  step.show.timer
    ? { paused: false, startsAt: at, endsAt: at + 40_000, detail: "TV Salon" }
    : step.show.since
    ? { since: at, detail: "Not answering" }
    : step.show.list
    ? sampleItems(at, last ? 4 : 1)
    : flow.subject === "request"
    ? { detail: last ? "Julie" : "Julie · Movie · 2008" }
    : {}

export const testScript = (flow: Flow, now: number, id: string): ReadonlyArray<Beat> => {
  const subjectKey = `test:${id}`
  let activity: Activity = {
    key: activityKey(flow.id, subjectKey),
    flowId: flow.id,
    subjectKey,
    title: titles[flow.subject],
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
    const ends = endsAtStep(flow, index)
    const at = clock + (index === 0 ? 0 : 5_000)
    const values = sampleValues(flow, step, at, index === flow.steps.length - 1)
    beat(index === 0 ? 0 : 5_000, index === 0 ? "Start" : ends ? "End" : "Update", {
      stepIndex: index,
      enteredAt: at,
      endedAt: ends ? at : null,
      tone: ends ? "done" : "active",
      values
    })
    if (step.show.progress && !ends) {
      for (const progress of [0.12, 0.31, 0.52, 0.74, 0.93, 1]) {
        beat(4_000, "Update", { values: { progress, bytesPerSecond: 11_534_336, remainingSeconds: Math.round((1 - progress) * 24) } })
      }
    }
    if (step.show.list && !ends) {
      beat(5_000, "Update", { values: sampleItems(clock + 5_000, 2) })
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
