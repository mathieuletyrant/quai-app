import type { ActivityAttributes, ActivityContent, DevicePreferences, Flow, FlowPreference } from "@quai/api"
import type { Activity, Push } from "./Engine.ts"

export const preferenceFor = (preferences: DevicePreferences, flowId: string): FlowPreference =>
  preferences.flows[flowId] ?? { enabled: true, hiddenSteps: [] }

/** The steps this iPhone shows for a flow, in order. The last one always: it ends the activity. */
export const visibleSteps = (flow: Flow, preference: FlowPreference) =>
  flow.steps.filter((step, index) => index === flow.steps.length - 1 || !preference.hiddenSteps.includes(step.id))

export const attributesFor = (flow: Flow, activity: Activity, preference: FlowPreference): ActivityAttributes => ({
  key: activity.key,
  flowId: flow.id,
  title: activity.title,
  color: flow.color,
  icon: flow.icon,
  steps: visibleSteps(flow, preference).map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    ...(s.actions !== undefined && s.actions.length > 0 ? { actions: s.actions } : {})
  }))
})

const seconds = (ms: number) => Math.floor(ms / 1000)

/** What the iPhone draws now: only the values the current step shows. Null when the step is hidden. */
export const contentFor = (flow: Flow, activity: Activity, preference: FlowPreference): ActivityContent | null => {
  const step = flow.steps[activity.stepIndex]
  if (step === undefined) return null
  const index = visibleSteps(flow, preference).indexOf(step)
  if (index < 0) return null
  const v = activity.values
  const show = step.show
  return {
    step: index,
    tone: activity.endedAt !== null ? "done" : activity.tone,
    ...(show.progress && v.progress !== undefined ? { progress: v.progress } : {}),
    ...(show.speed && v.bytesPerSecond !== undefined ? { bytesPerSecond: v.bytesPerSecond } : {}),
    ...(show.eta && v.remainingSeconds !== undefined ? { remainingSeconds: v.remainingSeconds } : {}),
    ...(show.timer && v.endsAt !== undefined ? { endsAt: seconds(v.endsAt) } : {}),
    ...(show.timer && v.startsAt !== undefined ? { startsAt: seconds(v.startsAt) } : {}),
    // Paused or not drives the label and the Play/Pause button, whatever the step shows.
    ...(v.paused !== undefined ? { paused: v.paused } : {}),
    // A paused timeline holds where it is: the iPhone needs the fraction to draw it.
    ...(show.timer && !show.progress && v.paused === true && v.progress !== undefined ? { progress: v.progress } : {}),
    ...(show.since ? { since: seconds(v.since ?? activity.enteredAt) } : {}),
    ...(v.detail !== undefined ? { detail: v.detail } : {})
  }
}

/** What to send one iPhone for one push. */
export type Delivery =
  | { readonly _tag: "None" }
  | { readonly _tag: "Start"; readonly token: string; readonly attributes: ActivityAttributes; readonly content: ActivityContent }
  | { readonly _tag: "Update"; readonly token: string; readonly content: ActivityContent }
  | { readonly _tag: "End"; readonly token: string; readonly content: ActivityContent; readonly dismissAt: number }

/**
 * Decides, for one iPhone, what an engine push becomes: nothing for a hidden step or a flow it
 * turned off, a start at its first shown step, updates while shown, the end with the flow's linger.
 */
export const deliveryFor = (
  push: Push,
  flow: Flow,
  target: {
    readonly preferences: DevicePreferences
    readonly pushToStartToken: string | null
    readonly activityToken: string | null
    readonly shown: boolean
    /** Where the activity was when this iPhone's user swiped it away, if they did. */
    readonly dismissed?: { readonly stepIndex: number; readonly paused: boolean | null } | null
  },
  now: number
): Delivery => {
  const none: Delivery = { _tag: "None" }
  const preference = preferenceFor(target.preferences, flow.id)
  if (!preference.enabled) return none
  const content = contentFor(flow, push.activity, preference)
  const dismissed = target.dismissed ?? null
  if (dismissed !== null) {
    // Swiped away: it stays away until it changes for real (a step, a pause or a resume), then
    // starts again as a new activity.
    const paused = push.activity.values.paused ?? null
    if (push._tag === "End" || (push.activity.stepIndex === dismissed.stepIndex && paused === dismissed.paused)) return none
    if (content === null || target.pushToStartToken === null) return none
    return { _tag: "Start", token: target.pushToStartToken, attributes: attributesFor(flow, push.activity, preference), content }
  }

  if (push._tag === "End") {
    if (!target.shown || target.activityToken === null) return none
    const last = visibleSteps(flow, preference).length - 1
    return {
      _tag: "End",
      token: target.activityToken,
      content: content ?? { step: last, tone: "done" },
      dismissAt: now + flow.lingerMinutes * 60_000
    }
  }
  if (content === null) return none
  if (target.shown) {
    // Shown but its token isn't known yet: the next update will reach it.
    return target.activityToken === null ? none : { _tag: "Update", token: target.activityToken, content }
  }
  if (target.pushToStartToken === null) return none
  return { _tag: "Start", token: target.pushToStartToken, attributes: attributesFor(flow, push.activity, preference), content }
}
