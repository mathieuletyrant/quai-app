import { type Flow, type FlowStep, isDataEvent } from "@quai/api"
import type { FlowEvent, MediaLookup, Subject, Values } from "./Events.ts"

/** Timings from the spec (docs/flows.md, Limits). */
export const Timing = {
  /** At most one data update per activity every 5 s (the heartbeat flushes what it held back). */
  throttleMs: 5_000
} as const

export type Tone = "active" | "stalled" | "done"

export interface Activity {
  /** `flowId|subjectKey` */
  readonly key: string
  readonly flowId: string
  readonly subjectKey: string
  readonly title: string
  readonly stepIndex: number
  readonly tone: Tone
  readonly values: Values
  readonly downloadId: string | null
  /** How to find the title in the media server, once a service told. */
  readonly lookup: MediaLookup | null
  /** When the current step began. */
  readonly enteredAt: number
  /** Last forward movement: step change or progress increase. */
  readonly movedAt: number
  /** Last event of any kind. */
  readonly lastEventAt: number
  /** Set once the last step is reached (or the activity expired). */
  readonly endedAt: number | null
  readonly pushedAt: number | null
  /** Fingerprint of the last pushed state, to skip pushes that change nothing. */
  readonly pushedFingerprint: string | null
}

export interface EngineState {
  readonly activities: ReadonlyMap<string, Activity>
}

export const emptyState: EngineState = { activities: new Map() }

/** A flow-level push; the notifier turns it into one APNs request per iPhone. */
export interface Push {
  readonly _tag: "Start" | "Update" | "End"
  readonly activity: Activity
}

export interface Result {
  readonly state: EngineState
  readonly pushes: ReadonlyArray<Push>
}

export const activityKey = (flowId: string, subjectKey: string) => `${flowId}|${subjectKey}`

/**
 * What a push would change on screen. Times are rounded to 10 s: a playback's end time drifts by
 * milliseconds between polls, and the iPhone animates the bar itself, so only a seek is news.
 */
const fingerprint = (a: Activity) => {
  const round = (ms: number | undefined) => ms === undefined ? undefined : Math.round(ms / 10_000)
  const { endsAt, startsAt, ...rest } = a.values
  return JSON.stringify([a.stepIndex, a.tone, rest, round(endsAt), round(startsAt)])
}

const matches = (flow: Flow, subject: Subject) => {
  if (!flow.enabled || flow.subject !== subject.kind) return false
  if (subject.kind === "media" || subject.kind === "request") {
    const wanted = flow.filter.mediaType ?? "any"
    return wanted === "any" || wanted === subject.mediaType
  }
  if (subject.kind === "playback") {
    const devices = flow.filter.devices ?? []
    return devices.length === 0 || devices.includes(subject.device)
  }
  return true
}

/**
 * Reaching the last step ends the activity. A one-step flow with an end event (playback) runs
 * until that event instead: its only step is where it starts.
 */
const endsAtStep = (flow: Flow, index: number) =>
  index === flow.steps.length - 1 && (flow.endOn === undefined || flow.steps.length > 1)

const lookupOf = (subject: Subject) => subject.kind === "media" ? subject.lookup ?? null : null

const put = (activities: Map<string, Activity>, activity: Activity) => activities.set(activity.key, activity)

const pushed = (activity: Activity, now: number): Activity => ({
  ...activity,
  pushedAt: now,
  pushedFingerprint: fingerprint(activity)
})

/**
 * Applies one event to every flow it concerns. Pure: the same state, flows, event and time always
 * give the same result.
 */
export const onEvent = (state: EngineState, flows: ReadonlyArray<Flow>, event: FlowEvent, now: number): Result => {
  const activities = new Map(state.activities)
  const pushes: Array<Push> = []

  if (isDataEvent(event.type)) {
    for (const activity of state.activities.values()) {
      if (activity.endedAt !== null) continue
      if (event.flowId !== undefined && activity.flowId !== event.flowId) continue
      const flow = flows.find((f) => f.id === activity.flowId)
      if (flow === undefined) continue
      const step = flow.steps[activity.stepIndex]!
      const concerned = event.type === "download.progress"
        ? event.downloadId !== undefined && activity.downloadId === event.downloadId && step.show.progress === true
        : event.subject !== undefined && activity.subjectKey === event.subject.key
      if (!concerned) continue
      // A progress reading replaces the whole download reading: an ETA that turns unknown (paused,
      // no peers) is left out of the event and must not keep the last one on screen.
      const { remainingSeconds: _, ...kept } = activity.values
      const values = { ...(event.type === "download.progress" ? kept : activity.values), ...event.values }
      const moved = (event.values?.progress ?? -1) > (activity.values.progress ?? -1)
      const next: Activity = {
        ...activity,
        values,
        tone: moved && activity.tone === "stalled" ? "active" : activity.tone,
        movedAt: moved ? now : activity.movedAt,
        lastEventAt: now
      }
      // A visible change of state goes at once: a download moving again, a pause or a resume.
      const urgent = (activity.tone === "stalled" && next.tone === "active") ||
        (event.values?.paused !== undefined && event.values.paused !== activity.values.paused)
      const throttled = activity.pushedAt !== null && now - activity.pushedAt < Timing.throttleMs
      if ((throttled && !urgent) || fingerprint(next) === activity.pushedFingerprint) {
        put(activities, next)
      } else {
        const sent = pushed(next, now)
        put(activities, sent)
        pushes.push({ _tag: "Update", activity: sent })
      }
    }
    return { state: { activities }, pushes }
  }

  const subject = event.subject
  if (subject === undefined) return { state, pushes: [] }
  for (const flow of flows) {
    if (event.flowId !== undefined && flow.id !== event.flowId) continue
    if (!matches(flow, subject)) continue
    const key = activityKey(flow.id, subject.key)
    const current = activities.get(key)

    if (flow.endOn === event.type) {
      if (current === undefined || current.endedAt !== null) continue
      // What the end event says ("Declined") shows on the ended activity.
      const values = event.values === undefined ? current.values : { ...current.values, ...event.values }
      const ended = pushed({ ...current, values, tone: "done", endedAt: now, lastEventAt: now }, now)
      put(activities, ended)
      pushes.push({ _tag: "End", activity: ended })
      continue
    }
    const index = flow.steps.findIndex((s) => s.on === event.type)
    if (index < 0) continue

    if (current === undefined) {
      // Nothing to finish: an end event alone (a service back that was never down) starts nothing.
      if (endsAtStep(flow, index)) continue
      const created: Activity = {
        key,
        flowId: flow.id,
        subjectKey: subject.key,
        title: subject.title,
        stepIndex: index,
        tone: "active",
        values: event.values ?? {},
        downloadId: event.downloadId ?? null,
        lookup: lookupOf(subject),
        enteredAt: now,
        movedAt: now,
        lastEventAt: now,
        endedAt: null,
        pushedAt: null,
        pushedFingerprint: null
      }
      const sent = pushed(created, now)
      put(activities, sent)
      pushes.push({ _tag: "Start", activity: sent })
      continue
    }
    if (current.endedAt !== null) continue

    const regrab = index === current.stepIndex && event.downloadId !== undefined && event.downloadId !== current.downloadId
    if (index < current.stepIndex || (index === current.stepIndex && !regrab)) {
      put(activities, { ...current, lastEventAt: now })
      continue
    }
    const ends = endsAtStep(flow, index)
    const next: Activity = {
      ...current,
      title: subject.title,
      stepIndex: index,
      tone: ends ? "done" : "active",
      values: event.values ?? {},
      downloadId: event.downloadId ?? current.downloadId,
      lookup: lookupOf(subject) ?? current.lookup,
      enteredAt: now,
      movedAt: now,
      lastEventAt: now,
      endedAt: ends ? now : null
    }
    const sent = pushed(next, now)
    put(activities, sent)
    pushes.push({ _tag: ends ? "End" : "Update", activity: sent })
  }
  return { state: { activities }, pushes }
}

const showsProgress = (step: FlowStep) => step.show.progress === true

/**
 * Runs on a timer: flushes data held back by the throttle, turns stalled downloads grey, ends
 * activities that expired, and forgets ended ones once their linger time is over.
 */
export const onTick = (state: EngineState, flows: ReadonlyArray<Flow>, now: number): Result => {
  const activities = new Map(state.activities)
  const pushes: Array<Push> = []
  for (const activity of state.activities.values()) {
    const flow = flows.find((f) => f.id === activity.flowId)
    if (flow === undefined) {
      // The flow was deleted: close what's on screen and forget it.
      activities.delete(activity.key)
      if (activity.endedAt === null) pushes.push({ _tag: "End", activity: { ...activity, endedAt: now } })
      continue
    }
    if (activity.endedAt !== null) {
      if (now - activity.endedAt >= flow.lingerMinutes * 60_000) activities.delete(activity.key)
      continue
    }
    const step = flow.steps[activity.stepIndex]!
    if (flow.expireAfterMinutes !== undefined && now - activity.lastEventAt >= flow.expireAfterMinutes * 60_000) {
      const ended = pushed({ ...activity, endedAt: now }, now)
      put(activities, ended)
      pushes.push({ _tag: "End", activity: ended })
      continue
    }
    let next = activity
    if (
      showsProgress(step) && flow.stalledAfterMinutes !== undefined && activity.tone === "active" &&
      now - activity.movedAt >= flow.stalledAfterMinutes * 60_000
    ) {
      next = { ...activity, tone: "stalled" }
    }
    const stalledNow = next.tone === "stalled" && activity.tone !== "stalled"
    const throttleOver = activity.pushedAt === null || now - activity.pushedAt >= Timing.throttleMs
    if ((throttleOver || stalledNow) && fingerprint(next) !== activity.pushedFingerprint) {
      const sent = pushed(next, now)
      put(activities, sent)
      pushes.push({ _tag: "Update", activity: sent })
    } else if (next !== activity) {
      put(activities, next)
    }
  }
  return { state: { activities }, pushes }
}
