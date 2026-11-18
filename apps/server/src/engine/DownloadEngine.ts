import type { DownloadAttributes, DownloadContentState, DownloadStep } from "@quai/api"
import type { MediaEvent } from "./Events.ts"

/** Timings from the spec (docs/spec-v1.md, Live Activities). */
export const Timing = {
  /** At most one progress update per activity every 15 s. */
  progressThrottleMs: 15_000,
  /** No progress (or no grab) for this long: the activity turns grey with "Other release". */
  stalledAfterMs: 2 * 60 * 60_000,
  /** Once available, the activity stays on screen this long with "Play". */
  lingerAfterAvailableMs: 15 * 60_000
} as const

export interface Activity {
  readonly attributes: DownloadAttributes
  readonly content: DownloadContentState
  readonly downloadId: string | null
  /** Last time the download moved forward (step change or progress increase). */
  readonly movedAt: number
  /** Last pushed content, to skip pushes that would change nothing. */
  readonly pushed: DownloadContentState | null
  readonly pushedAt: number | null
}

export interface EngineState {
  readonly activities: ReadonlyMap<string, Activity>
}

export const emptyState: EngineState = { activities: new Map() }

/** A push the engine wants sent. The notifier turns it into APNs requests, per device. */
export type Push =
  | { readonly _tag: "Start"; readonly attributes: DownloadAttributes; readonly content: DownloadContentState }
  | {
    readonly _tag: "Update"
    readonly mediaKey: string
    /** Lets an iPhone that hides the earlier steps start the activity from this update. */
    readonly title: string
    readonly content: DownloadContentState
  }
  | {
    readonly _tag: "End"
    readonly mediaKey: string
    readonly content: DownloadContentState
    /** When iOS should remove it from the Lock Screen (ms since epoch). */
    readonly dismissAt: number
  }

export interface Step {
  readonly state: EngineState
  readonly pushes: ReadonlyArray<Push>
}

const stepOrder: Record<DownloadStep, number> = { searching: 0, downloading: 1, importing: 2, available: 3 }

/** Drops the keys whose value is unknown: the content-state leaves them out. */
const known = (fields: {
  readonly progress?: number | null | undefined
  readonly bytesPerSecond?: number | null | undefined
  readonly remainingSeconds?: number | null | undefined
}) => ({
  ...(fields.progress == null ? {} : { progress: fields.progress }),
  ...(fields.bytesPerSecond == null ? {} : { bytesPerSecond: fields.bytesPerSecond }),
  ...(fields.remainingSeconds == null ? {} : { remainingSeconds: fields.remainingSeconds })
})

const content = (step: DownloadStep, previous?: DownloadContentState): DownloadContentState =>
  step === "downloading"
    ? { step, ...known({ ...previous, progress: previous?.progress ?? 0 }), stalled: false }
    : { step, stalled: false }

const sameContent = (a: DownloadContentState | null, b: DownloadContentState) =>
  a !== null && a.step === b.step && a.progress === b.progress && a.bytesPerSecond === b.bytesPerSecond &&
  a.remainingSeconds === b.remainingSeconds && a.stalled === b.stalled

const withActivity = (state: EngineState, activity: Activity): EngineState => {
  const activities = new Map(state.activities)
  activities.set(activity.attributes.mediaKey, activity)
  return { activities }
}

const withoutActivity = (state: EngineState, mediaKey: string): EngineState => {
  const activities = new Map(state.activities)
  activities.delete(mediaKey)
  return { activities }
}

const markPushed = (activity: Activity, now: number): Activity => ({
  ...activity,
  pushed: activity.content,
  pushedAt: now
})

/** Starts an activity, or moves an existing one forward to `step` (never backwards). */
const advance = (
  state: EngineState,
  mediaKey: string,
  title: string,
  step: DownloadStep,
  now: number,
  downloadId: string | null
): Step => {
  const current = state.activities.get(mediaKey)
  if (current === undefined) {
    const activity: Activity = {
      attributes: { mediaKey, title },
      content: content(step),
      downloadId,
      movedAt: now,
      pushed: null,
      pushedAt: null
    }
    return {
      state: withActivity(state, markPushed(activity, now)),
      pushes: [{ _tag: "Start", attributes: activity.attributes, content: activity.content }]
    }
  }
  if (stepOrder[step] < stepOrder[current.content.step]) return { state, pushes: [] }
  if (step === current.content.step && downloadId === current.downloadId) return { state, pushes: [] }
  const next: Activity = {
    ...current,
    content: content(step, step === current.content.step ? current.content : undefined),
    downloadId: downloadId ?? current.downloadId,
    movedAt: now
  }
  if (sameContent(current.pushed, next.content)) return { state: withActivity(state, next), pushes: [] }
  const pushed = markPushed(next, now)
  return { state: withActivity(state, pushed), pushes: [update(pushed, now)] }
}

const update = (activity: Activity, now: number): Push =>
  activity.content.step === "available"
    ? {
      _tag: "End",
      mediaKey: activity.attributes.mediaKey,
      content: activity.content,
      dismissAt: now + Timing.lingerAfterAvailableMs
    }
    : { _tag: "Update", mediaKey: activity.attributes.mediaKey, title: activity.attributes.title, content: activity.content }

const progress = (state: EngineState, event: Extract<MediaEvent, { _tag: "Progress" }>, now: number): Step => {
  const current = [...state.activities.values()].find((a) => a.downloadId === event.downloadId)
  if (current === undefined || current.content.step !== "downloading") return { state, pushes: [] }
  const moved = event.progress > (current.content.progress ?? 0)
  const next: Activity = {
    ...current,
    content: {
      step: current.content.step,
      ...known(event),
      stalled: moved ? false : current.content.stalled
    },
    movedAt: moved ? now : current.movedAt
  }
  // A stalled download that moves again is a visible change: push it at once.
  const unstalled = current.content.stalled && !next.content.stalled
  const throttled = current.pushedAt !== null && now - current.pushedAt < Timing.progressThrottleMs
  if ((throttled && !unstalled) || sameContent(current.pushed, next.content)) {
    return { state: withActivity(state, next), pushes: [] }
  }
  const pushed = markPushed(next, now)
  return { state: withActivity(state, pushed), pushes: [update(pushed, now)] }
}

/** Applies one event. Pure: same state, event and time always give the same result. */
export const onEvent = (state: EngineState, event: MediaEvent, now: number): Step => {
  switch (event._tag) {
    case "Added":
      return state.activities.has(event.mediaKey)
        ? { state, pushes: [] }
        : advance(state, event.mediaKey, event.title, "searching", now, null)
    case "Grabbed":
      return advance(state, event.mediaKey, event.title, "downloading", now, event.downloadId)
    case "Progress":
      return progress(state, event, now)
    case "Imported":
      return advance(state, event.mediaKey, event.title, "importing", now, null)
    case "Available": {
      const current = state.activities.get(event.mediaKey)
      if (current === undefined) return { state, pushes: [] }
      return advance(state, event.mediaKey, current.attributes.title, "available", now, null)
    }
  }
}

/**
 * Runs on a timer: flushes progress held back by the throttle, marks stalled downloads, and forgets
 * activities whose linger time is over.
 */
export const onTick = (state: EngineState, now: number): Step => {
  let next = state
  const pushes: Array<Push> = []
  for (const activity of state.activities.values()) {
    if (activity.content.step === "available") {
      if (activity.pushedAt !== null && now - activity.pushedAt >= Timing.lingerAfterAvailableMs) {
        next = withoutActivity(next, activity.attributes.mediaKey)
      }
      continue
    }
    let current = activity
    const canStall = current.content.step === "searching" || current.content.step === "downloading"
    if (canStall && !current.content.stalled && now - current.movedAt >= Timing.stalledAfterMs) {
      current = { ...current, content: { ...current.content, stalled: true } }
    }
    const throttleOver = current.pushedAt === null || now - current.pushedAt >= Timing.progressThrottleMs
    const stalledNow = current.content.stalled && !activity.content.stalled
    if ((throttleOver || stalledNow) && !sameContent(current.pushed, current.content)) {
      current = markPushed(current, now)
      pushes.push(update(current, now))
    }
    if (current !== activity) next = withActivity(next, current)
  }
  return { state: next, pushes }
}
