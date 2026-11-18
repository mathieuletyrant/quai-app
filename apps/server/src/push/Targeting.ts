import type { DevicePreferences, DownloadStep } from "@quai/api"
import type { Push } from "../engine/DownloadEngine.ts"

/** What to send one iPhone for one push, given its preferences and what it already shows. */
export type Delivery =
  | { readonly _tag: "None" }
  | { readonly _tag: "Start"; readonly token: string; readonly push: Extract<Push, { _tag: "Start" }> }
  | { readonly _tag: "Update"; readonly token: string; readonly push: Extract<Push, { _tag: "Update" }> }
  | { readonly _tag: "End"; readonly token: string; readonly push: Extract<Push, { _tag: "End" }> }

export const allSteps: ReadonlyArray<DownloadStep> = ["searching", "downloading", "importing", "available"]

/** The steps this iPhone shows, in order. `available` always: it ends the activity. */
export const visibleSteps = (preferences: DevicePreferences): ReadonlyArray<DownloadStep> =>
  allSteps.filter((step) => step === "available" || preferences.download.steps.includes(step))

/**
 * Decides, for one iPhone, what an engine push becomes. The engine follows every step for every
 * title; each iPhone only sees the steps it chose, and its activity starts at the first of them.
 *
 * - `shown`: this iPhone already shows the activity (it was started on it).
 * - `activityToken`: the activity's own push token on this iPhone, once reported.
 */
export const deliveryFor = (
  push: Push,
  target: {
    readonly preferences: DevicePreferences
    readonly pushToStartToken: string | null
    readonly activityToken: string | null
    readonly shown: boolean
  },
  now: number
): Delivery => {
  const none: Delivery = { _tag: "None" }
  if (!target.preferences.download.enabled) return none
  const steps = visibleSteps(target.preferences)
  const visible = steps.includes(push.content.step)

  if (push._tag === "End") {
    if (!target.shown || target.activityToken === null) return none
    const dismissAt = now + target.preferences.download.lingerMinutes * 60_000
    return { _tag: "End", token: target.activityToken, push: { ...push, dismissAt } }
  }
  if (!visible) return none
  if (target.shown) {
    // Shown but its token isn't known yet: the next update will reach it.
    if (target.activityToken === null) return none
    const update: Extract<Push, { _tag: "Update" }> = push._tag === "Start"
      ? { _tag: "Update", mediaKey: push.attributes.mediaKey, title: push.attributes.title, content: push.content }
      : push
    return { _tag: "Update", token: target.activityToken, push: update }
  }
  if (target.pushToStartToken === null) return none
  const mediaKey = push._tag === "Start" ? push.attributes.mediaKey : push.mediaKey
  const title = push._tag === "Start" ? push.attributes.title : push.title
  return {
    _tag: "Start",
    token: target.pushToStartToken,
    push: { _tag: "Start", attributes: { mediaKey, title, steps: [...steps] }, content: push.content }
  }
}
