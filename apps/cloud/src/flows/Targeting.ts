import {
  type ActivityAttributes,
  type ActivityContent,
  type DevicePreferences,
  type Flow,
  type FlowPreference,
  type FlowStep,
  type StepShow,
  stepShows
} from "@quai/api"
import type { Activity, Push } from "./Engine.ts"
import type { Values } from "./Events.ts"

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
  steps: visibleSteps(flow, preference).map((step) => ({
    id: step.id,
    label: step.label,
    icon: step.icon,
    ...(step.actions !== undefined && step.actions.length > 0 ? { actions: step.actions } : {})
  }))
})

const seconds = (ms: number) => Math.floor(ms / 1000)

/**
 * Only what this kind of flow can show, whatever an older saved flow asks for: a playback step
 * with Progress would otherwise keep the last paused fraction over the countdown.
 */
const showableFor = (flow: Flow, step: FlowStep): StepShow =>
  Object.fromEntries(
    Object.entries(step.show).filter(([key]) => (stepShows[flow.subject] as ReadonlyArray<string>).includes(key))
  ) as StepShow

const downloadContent = (show: StepShow, values: Values) => ({
  ...(show.progress && values.progress !== undefined ? { progress: values.progress } : {}),
  ...(show.speed && values.bytesPerSecond !== undefined ? { bytesPerSecond: values.bytesPerSecond } : {}),
  ...(show.eta && values.remainingSeconds !== undefined ? { remainingSeconds: values.remainingSeconds } : {})
})

const timelineContent = (show: StepShow, values: Values) => ({
  ...(show.timer && values.endsAt !== undefined ? { endsAt: seconds(values.endsAt) } : {}),
  ...(show.timer && values.startsAt !== undefined ? { startsAt: seconds(values.startsAt) } : {}),
  // Paused or not drives the label and the Play/Pause button, whatever the step shows.
  ...(values.paused !== undefined ? { paused: values.paused } : {}),
  // A paused timeline holds where it is: the iPhone needs the fraction to draw it.
  ...(show.timer && !show.progress && values.paused === true && values.progress !== undefined
    ? { progress: values.progress }
    : {})
})

const listContent = (show: StepShow, values: Values) => ({
  ...(show.list && values.items !== undefined ? { items: values.items } : {}),
  ...(show.list && values.here !== undefined ? { here: values.here } : {}),
  ...(show.list && values.total !== undefined ? { total: values.total } : {})
})

/** What the iPhone draws now: only the values the current step shows. Null when the step is hidden. */
export const contentFor = (flow: Flow, activity: Activity, preference: FlowPreference): ActivityContent | null => {
  const step = flow.steps[activity.stepIndex]
  if (step === undefined) return null
  const index = visibleSteps(flow, preference).indexOf(step)
  if (index < 0) return null
  const values = activity.values
  const show = showableFor(flow, step)
  return {
    step: index,
    tone: activity.endedAt !== null ? "done" : activity.tone,
    ...downloadContent(show, values),
    ...timelineContent(show, values),
    ...(show.since ? { since: seconds(values.since ?? activity.enteredAt) } : {}),
    ...(values.detail !== undefined ? { detail: values.detail } : {}),
    ...listContent(show, values)
  }
}

/** What to send one iPhone for one push. */
export type Delivery =
  | { readonly _tag: "None" }
  | {
    readonly _tag: "Start"
    readonly token: string
    readonly attributes: ActivityAttributes
    readonly content: ActivityContent
  }
  | { readonly _tag: "Update"; readonly token: string; readonly content: ActivityContent }
  | { readonly _tag: "End"; readonly token: string; readonly content: ActivityContent; readonly dismissAt: number }

/** Where the activity was when an iPhone's user swiped it away. */
interface Dismissed {
  readonly stepIndex: number
  readonly paused: boolean | null
}

/** One iPhone, as a push reaches it. */
interface Target {
  readonly preferences: DevicePreferences
  readonly pushToStartToken: string | null
  readonly activityToken: string | null
  readonly shown: boolean
  /** Where the activity was when this iPhone's user swiped it away, if they did. */
  readonly dismissed?: Dismissed | null
}

const none: Delivery = { _tag: "None" }

/**
 * Swiped away: it stays away until it changes for real (a step, a pause or a resume), then starts
 * again as a new activity.
 */
const staysSwipedAway = (push: Push, dismissed: Dismissed) =>
  push._tag === "End" ||
  (push.activity.stepIndex === dismissed.stepIndex && (push.activity.values.paused ?? null) === dismissed.paused)

const startDelivery = (
  token: string | null,
  attributes: ActivityAttributes,
  content: ActivityContent | null
): Delivery => token === null || content === null ? none : { _tag: "Start", token, attributes, content }

/** Shown but its token isn't known yet: the next update will reach it. */
const updateDelivery = (token: string | null, content: ActivityContent): Delivery =>
  token === null ? none : { _tag: "Update", token, content }

const endDelivery = (target: Target, content: ActivityContent, dismissAt: number): Delivery =>
  !target.shown || target.activityToken === null
    ? none
    : { _tag: "End", token: target.activityToken, content, dismissAt }

/** An ended activity on a step this iPhone hides shows as its last shown step, done. */
const lastStepDone = (flow: Flow, preference: FlowPreference): ActivityContent => ({
  step: visibleSteps(flow, preference).length - 1,
  tone: "done"
})

/**
 * Decides, for one iPhone, what an engine push becomes: nothing for a hidden step or a flow it
 * turned off, a start at its first shown step, updates while shown, the end with the flow's linger.
 */
export const deliveryFor = (push: Push, flow: Flow, target: Target, now: number): Delivery => {
  const preference = preferenceFor(target.preferences, flow.id)
  if (!preference.enabled) return none
  const content = contentFor(flow, push.activity, preference)
  const dismissed = target.dismissed ?? null
  if (dismissed !== null) {
    if (staysSwipedAway(push, dismissed)) return none
    return startDelivery(target.pushToStartToken, attributesFor(flow, push.activity, preference), content)
  }
  if (push._tag === "End") {
    return endDelivery(target, content ?? lastStepDone(flow, preference), now + flow.lingerMinutes * 60_000)
  }
  if (content === null) return none
  if (target.shown) return updateDelivery(target.activityToken, content)
  return startDelivery(target.pushToStartToken, attributesFor(flow, push.activity, preference), content)
}
