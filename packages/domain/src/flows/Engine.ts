import { type Flow, type FlowStep, isDataEvent } from "@quai/api"
import { type FlowEvent, type MediaLookup, narrowsLookup, type Subject, type Values, widenLookup } from "./Events.ts"

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

/** An activity key's flow and subject; null for a key `activityKey` didn't make. */
export const parseActivityKey = (key: string): { readonly flowId: string; readonly subjectKey: string } | null => {
  const bar = key.indexOf("|")
  return bar <= 0 ? null : { flowId: key.slice(0, bar), subjectKey: key.slice(bar + 1) }
}

/**
 * What a push would change on screen. Times are rounded to 10 s: a playback's end time drifts by
 * milliseconds between polls, and the iPhone animates the bar itself, so only a seek is news.
 */
const fingerprint = (activity: Activity) => {
  const round = (ms: number | undefined) => ms === undefined ? undefined : Math.round(ms / 10_000)
  const { endsAt, startsAt, ...rest } = activity.values
  return JSON.stringify([activity.stepIndex, activity.tone, rest, round(endsAt), round(startsAt)])
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
export const endsAtStep = (flow: Flow, index: number) =>
  index === flow.steps.length - 1 && (flow.endOn === undefined || flow.steps.length > 1)

const lookupOf = (subject: Subject) => subject.kind === "media" ? subject.lookup ?? null : null

const put = (activities: Map<string, Activity>, activity: Activity) => activities.set(activity.key, activity)

/**
 * An activity whose flow was deleted, disabled, or edited so that the step it is on is gone: close
 * what's on screen and forget it.
 */
const forget = (activities: Map<string, Activity>, pushes: Array<Push>, activity: Activity, now: number) => {
  activities.delete(activity.key)
  if (activity.endedAt === null) pushes.push({ _tag: "End", activity: { ...activity, endedAt: now } })
}

/** A download's progress in whole percent, as the iPhone shows it; -1 before any reading. */
const percent = (progress: number | undefined) => progress === undefined ? -1 : Math.floor(progress * 100)

/**
 * Whether a progress reading moves the download forward: one more percent on screen. A torrent
 * without seeders trickles in a few bytes at a time and stays at 0 %: that's stalled, not moving.
 */
export const movedOn = (before: number | undefined, after: number | undefined): boolean =>
  after !== undefined && percent(after) > percent(before)

const pushed = (activity: Activity, now: number): Activity => ({
  ...activity,
  pushedAt: now,
  pushedFingerprint: fingerprint(activity)
})

/** What one event or tick does to one activity: its new state, and the push it makes, if any. */
interface Change {
  readonly activity: Activity
  readonly push: Push["_tag"] | null
}

const record = (activities: Map<string, Activity>, pushes: Array<Push>, change: Change) => {
  put(activities, change.activity)
  if (change.push !== null) pushes.push({ _tag: change.push, activity: change.activity })
}

const minutes = (count: number) => count * 60_000

const showsProgress = (step: FlowStep) => step.show.progress === true

/** Pushed less than the throttle's time ago: a data update waits for the heartbeat. */
const throttled = (activity: Activity, now: number) =>
  activity.pushedAt !== null && now - activity.pushedAt < Timing.throttleMs

/**
 * Applies one event to every flow it concerns. Pure: the same state, flows, event and time always
 * give the same result.
 */
export const onEvent = (state: EngineState, flows: ReadonlyArray<Flow>, event: FlowEvent, now: number): Result =>
  isDataEvent(event.type) ? onDataEvent(state, flows, event, now) : onStepEvent(state, flows, event, now)

// Data events: they update the values of the activities they concern, never their step.

const onDataEvent = (state: EngineState, flows: ReadonlyArray<Flow>, event: FlowEvent, now: number): Result => {
  const activities = new Map(state.activities)
  const pushes: Array<Push> = []
  for (const activity of state.activities.values()) {
    if (activity.endedAt !== null) continue
    if (event.flowId !== undefined && activity.flowId !== event.flowId) continue
    const flow = flows.find((candidate) => candidate.id === activity.flowId)
    if (flow === undefined) continue
    const step = flow.steps[activity.stepIndex]
    if (step === undefined || !flow.enabled) {
      forget(activities, pushes, activity, now)
      continue
    }
    if (!concerns(event, activity, step)) continue
    record(activities, pushes, dataChange(activity, event, now))
  }
  return { state: { activities }, pushes }
}

/**
 * A download's events concern the activity of that download, while its step shows progress; the
 * others, the activity of their subject.
 */
const concerns = (event: FlowEvent, activity: Activity, step: FlowStep) =>
  event.type === "download.progress" || event.type === "download.removed"
    ? event.downloadId !== undefined && activity.downloadId === event.downloadId && showsProgress(step)
    : event.subject !== undefined && activity.subjectKey === event.subject.key

const dataChange = (activity: Activity, event: FlowEvent, now: number): Change => {
  if (event.type === "download.removed") return downloadRemoved(activity, event, now)
  const next = withData(activity, event, now)
  const sends = fingerprint(next) !== activity.pushedFingerprint &&
    (!throttled(activity, now) || urgent(activity, next, event))
  return sends ? { activity: pushed(next, now), push: "Update" } : { activity: next, push: null }
}

/**
 * The download left the client before its import (replaced, failed, removed): this activity won't
 * go further. It ends grey, saying so; a new grab starts its own.
 */
const downloadRemoved = (activity: Activity, event: FlowEvent, now: number): Change => ({
  activity: pushed({
    ...activity,
    tone: "stalled",
    values: { ...activity.values, ...event.values },
    lastEventAt: now,
    endedAt: now
  }, now),
  push: "End"
})

const withData = (activity: Activity, event: FlowEvent, now: number): Activity => {
  const moved = movedOn(activity.values.progress, event.values?.progress)
  return {
    ...activity,
    values: dataValues(activity, event),
    tone: dataTone(activity, event, moved),
    movedAt: moved ? now : activity.movedAt,
    lastEventAt: now
  }
}

/**
 * A progress reading replaces the whole download reading: an ETA that turns unknown (paused, no
 * peers) is left out of the event and must not keep the last one on screen.
 */
const dataValues = (activity: Activity, event: FlowEvent): Values => {
  if (event.type !== "download.progress") return { ...activity.values, ...event.values }
  const { remainingSeconds: _, ...kept } = activity.values
  return { ...kept, ...event.values }
}

const dataTone = (activity: Activity, event: FlowEvent, moved: boolean): Tone => {
  // Radarr or Sonarr waits for someone to import it: grey, saying so, until the next step.
  if (event.type === "media.importBlocked") return "stalled"
  if (moved && activity.tone === "stalled") return "active"
  return activity.tone
}

/** A visible change of state goes at once, throttled or not: a download moving again, blocked, a pause or a resume. */
const urgent = (activity: Activity, next: Activity, event: FlowEvent) =>
  (activity.tone === "stalled" && next.tone === "active") ||
  (event.type === "media.importBlocked" && activity.tone !== "stalled") ||
  (event.values?.paused !== undefined && event.values.paused !== activity.values.paused)

// Step events: they start, move forward or end the activity of each flow they match.

type SubjectEvent = FlowEvent & { readonly subject: Subject }

const onStepEvent = (state: EngineState, flows: ReadonlyArray<Flow>, event: FlowEvent, now: number): Result => {
  const subject = event.subject
  if (subject === undefined) return { state, pushes: [] }
  const subjectEvent: SubjectEvent = { ...event, subject }
  const activities = new Map(state.activities)
  const pushes: Array<Push> = []
  for (const flow of flows) {
    if (event.flowId !== undefined && flow.id !== event.flowId) continue
    if (!matches(flow, subject)) continue
    const current = currentActivity(flow, activities.get(activityKey(flow.id, subject.key)), subjectEvent)
    const change = stepChange(flow, current, subjectEvent, now)
    if (change !== null) record(activities, pushes, change)
  }
  return { state: { activities }, pushes }
}

/** A new download for an ended activity (its release removed, or an upgrade) starts it again. */
const currentActivity = (flow: Flow, previous: Activity | undefined, event: SubjectEvent) => {
  if (previous === undefined || previous.endedAt === null || flow.endOn === event.type) return previous
  const newDownload = event.downloadId !== undefined && event.downloadId !== previous.downloadId
  return newDownload ? undefined : previous
}

const stepChange = (flow: Flow, current: Activity | undefined, event: SubjectEvent, now: number): Change | null => {
  if (flow.endOn === event.type) return endedByEvent(current, event, now)
  const index = flow.steps.findIndex((step) => step.on === event.type)
  if (index < 0) return null
  if (current === undefined) return started(flow, index, event, now)
  if (current.endedAt !== null) return null
  if (!goesForward(current, index, event)) return { activity: passedOver(current, event, now), push: null }
  return movedTo(current, { index, ends: endsAtStep(flow, index) }, event, now)
}

const endedByEvent = (current: Activity | undefined, event: SubjectEvent, now: number): Change | null => {
  if (current === undefined || current.endedAt !== null) return null
  // What the end event says ("Declined") shows on the ended activity.
  const values = event.values === undefined ? current.values : { ...current.values, ...event.values }
  return { activity: pushed({ ...current, values, tone: "done", endedAt: now, lastEventAt: now }, now), push: "End" }
}

const started = (flow: Flow, index: number, event: SubjectEvent, now: number): Change | null => {
  // Nothing to finish: an end event alone (a service back that was never down) starts nothing.
  if (endsAtStep(flow, index)) return null
  const created: Activity = {
    key: activityKey(flow.id, event.subject.key),
    flowId: flow.id,
    subjectKey: event.subject.key,
    title: event.subject.title,
    stepIndex: index,
    tone: "active",
    values: event.values ?? {},
    downloadId: event.downloadId ?? null,
    lookup: lookupOf(event.subject),
    enteredAt: now,
    movedAt: now,
    lastEventAt: now,
    endedAt: null,
    pushedAt: null,
    pushedFingerprint: null
  }
  return { activity: pushed(created, now), push: "Start" }
}

/** A later step, or the same one again for another download (a regrab). */
const goesForward = (current: Activity, index: number, event: SubjectEvent) =>
  index > current.stepIndex ||
  (index === current.stepIndex && event.downloadId !== undefined && event.downloadId !== current.downloadId)

/** An earlier step, or the one it is on: nothing moves, but the event may tell more of where the title is. */
const passedOver = (current: Activity, event: SubjectEvent, now: number): Activity => ({
  ...current,
  lookup: widenLookup(current.lookup, lookupOf(event.subject)),
  lastEventAt: now
})

const movedTo = (
  current: Activity,
  step: { readonly index: number; readonly ends: boolean },
  event: SubjectEvent,
  now: number
): Change => {
  const lookup = lookupOf(event.subject)
  const next: Activity = {
    ...current,
    title: narrowsLookup(current.lookup, lookup) ? current.title : event.subject.title,
    stepIndex: step.index,
    tone: step.ends ? "done" : "active",
    values: event.values ?? {},
    downloadId: event.downloadId ?? current.downloadId,
    lookup: widenLookup(current.lookup, lookup),
    enteredAt: now,
    movedAt: now,
    lastEventAt: now,
    endedAt: step.ends ? now : null
  }
  return { activity: pushed(next, now), push: step.ends ? "End" : "Update" }
}

// The heartbeat.

/**
 * Runs on a timer: flushes data held back by the throttle, turns stalled downloads grey, ends
 * activities that expired, and forgets ended ones once their linger time is over.
 */
export const onTick = (state: EngineState, flows: ReadonlyArray<Flow>, now: number): Result => {
  const activities = new Map(state.activities)
  const pushes: Array<Push> = []
  for (const activity of state.activities.values()) {
    const flow = flows.find((candidate) => candidate.id === activity.flowId)
    if (flow === undefined || !flow.enabled) {
      forget(activities, pushes, activity, now)
      continue
    }
    if (activity.endedAt !== null) {
      if (lingered(flow, activity.endedAt, now)) activities.delete(activity.key)
      continue
    }
    const step = flow.steps[activity.stepIndex]
    if (step === undefined) {
      forget(activities, pushes, activity, now)
      continue
    }
    const change = tickChange(flow, step, activity, now)
    if (change !== null) record(activities, pushes, change)
  }
  return { state: { activities }, pushes }
}

const lingered = (flow: Flow, endedAt: number, now: number) => now - endedAt >= minutes(flow.lingerMinutes)

const expired = (flow: Flow, activity: Activity, now: number) =>
  flow.expireAfterMinutes !== undefined && now - activity.lastEventAt >= minutes(flow.expireAfterMinutes)

/** A download that hasn't moved for the flow's time. */
const stalls = (flow: Flow, step: FlowStep, activity: Activity, now: number) =>
  showsProgress(step) && flow.stalledAfterMinutes !== undefined && activity.tone === "active" &&
  now - activity.movedAt >= minutes(flow.stalledAfterMinutes)

const tickChange = (flow: Flow, step: FlowStep, activity: Activity, now: number): Change | null => {
  if (expired(flow, activity, now)) return { activity: pushed({ ...activity, endedAt: now }, now), push: "End" }
  const stalledNow = stalls(flow, step, activity, now)
  const next: Activity = stalledNow ? { ...activity, tone: "stalled" } : activity
  // Turning grey goes at once; what the throttle held back goes once its time is over.
  if ((!throttled(activity, now) || stalledNow) && fingerprint(next) !== activity.pushedFingerprint) {
    return { activity: pushed(next, now), push: "Update" }
  }
  return stalledNow ? { activity: next, push: null } : null
}
