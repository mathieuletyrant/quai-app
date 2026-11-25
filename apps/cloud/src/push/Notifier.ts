import type { DeviceId, Flow } from "@quai/api"
import { Clock, Context, Effect, Layer } from "effect"
import type { Push } from "../flows/Engine.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { deliveryFor } from "../flows/Targeting.ts"
import { Devices, type PushTarget } from "../home/Devices.ts"
import { Journal } from "../journal/Journal.ts"
import { Apns } from "./Apns.ts"
import { apnsBody } from "./ApnsPayload.ts"

const iphones = (count: number) => `${count} iPhone${count === 1 ? "" : "s"}`

/** "· pushed to 2 iPhones": where an activity's change went. */
const reach = (pushed: number, configured: boolean) =>
  !configured ? " · not pushed: no APNs key" : pushed === 0 ? " · no iPhone to push to" : ` · pushed to ${iphones(pushed)}`

/**
 * The journal's line for an activity that started, moved to another step or ended; null for an
 * update within its step (a progress), which only changes numbers.
 */
export const activityNote = (push: Push, flow: Flow, previousStep: number | undefined, pushed: number, configured: boolean) => {
  const { activity } = push
  const step = flow.steps[activity.stepIndex]?.label ?? "?"
  const what = push._tag === "Start"
    ? { kind: "activity.started", text: `${flow.name}: ${activity.title} started, “${step}”` }
    : push._tag === "End"
    ? { kind: "activity.ended", text: `${flow.name}: ${activity.title} ended, “${step}”` }
    : previousStep !== undefined && previousStep !== activity.stepIndex
    ? { kind: "activity.step", text: `${flow.name}: ${activity.title} is now “${step}”` }
    : null
  if (what === null) return null
  return {
    level: "info" as const,
    source: "cloud" as const,
    kind: what.kind,
    text: what.text + reach(pushed, configured),
    subject: activity.subjectKey,
    title: activity.title,
    flowId: flow.id
  }
}

/** Sends the engine's pushes to the paired iPhones, each according to its own preferences. */
export class Notifier extends Context.Service<Notifier, {
  readonly send: (pushes: ReadonlyArray<Push>) => Effect.Effect<void>
  /** Sends to one iPhone only, or every iPhone with `null` (test buttons). */
  readonly sendTo: (deviceId: DeviceId | null, pushes: ReadonlyArray<Push>) => Effect.Effect<void>
}>()("quai/Notifier") {
  static readonly layer = Layer.effect(
    Notifier,
    Effect.gen(function*() {
      const apns = yield* Apns
      const devices = yield* Devices
      const flowStore = yield* FlowStore
      const journal = yield* Journal
      /** The step each activity was last logged at, to log a step change once. */
      const loggedStep = new Map<string, number>()
      // Which iPhones show which activity. A reported activity token also counts, which covers
      // activities started before a restart.
      const shown = new Set<string>()
      const key = (deviceId: string, activityKey: string) => `${deviceId}\u0000${activityKey}`

      const logged = (push: Push, flow: Flow, pushed: number, configured: boolean) =>
        Effect.suspend(() => {
          const key = push.activity.key
          const note = activityNote(push, flow, loggedStep.get(key), pushed, configured)
          if (push._tag === "End") loggedStep.delete(key)
          else loggedStep.set(key, push.activity.stepIndex)
          return note === null ? Effect.void : journal.log(note)
        })

      const one = (push: Push, only: DeviceId | null) =>
        Effect.gen(function*() {
          const flow = (yield* flowStore.all).find((candidate) => candidate.id === push.activity.flowId)
          if (flow === undefined) return
          if (!(yield* apns.configured)) return yield* logged(push, flow, 0, false)
          const activityKey = push.activity.key
          const now = yield* Clock.currentTimeMillis
          const targets = (yield* devices.targets(activityKey)).filter((target) => only === null || target.deviceId === only)
          let pushed = 0
          yield* Effect.forEach(targets, (target: PushTarget) =>
            Effect.gen(function*() {
              const shownKey = key(target.deviceId, activityKey)
              const delivery = deliveryFor(push, flow, {
                preferences: target.preferences,
                pushToStartToken: target.pushToStartToken,
                activityToken: target.activityToken,
                shown: shown.has(shownKey) || target.activityToken !== null,
                dismissed: target.dismissed
              }, now)
              // The activity is over: nothing left to show again.
              if (push._tag === "End" && target.dismissed !== null) yield* devices.clearDismissed(target.deviceId, activityKey)
              if (delivery._tag === "None") return
              if (delivery._tag === "Start") shown.add(shownKey)
              if (delivery._tag === "Start" && target.dismissed !== null) yield* devices.clearDismissed(target.deviceId, activityKey)
              if (delivery._tag === "End") shown.delete(shownKey)
              const step = flow.steps[push.activity.stepIndex]?.id ?? "?"
              const progress = delivery.content.progress === undefined ? "" : ` ${Math.round(delivery.content.progress * 100)} %`
              yield* apns.send({
                environment: target.apnsEnvironment,
                deviceToken: delivery.token,
                body: apnsBody(delivery, now),
                // High priority: low priority let iOS hold updates back until the app opened.
                priority: 10
              }).pipe(
                Effect.tap(() => Effect.logInfo(`push ${delivery._tag} ${activityKey} ${step}${progress} → ${target.deviceId}`)),
                Effect.tap(() => Effect.sync(() => pushed++)),
                Effect.catchTag("ApnsError", (error) =>
                  Effect.gen(function*() {
                    yield* Effect.logWarning(`APNs refused a ${delivery._tag} for ${target.deviceId}: ${error.reason}`)
                    yield* journal.log({
                      level: "warn",
                      source: "apple",
                      kind: "push.refused",
                      text: `Apple refused the push to ${target.name}: ${error.reason}${error.tokenGone ? " (its token is gone: dropped)" : ""}`,
                      subject: push.activity.subjectKey,
                      title: push.activity.title,
                      flowId: flow.id,
                      deviceName: target.name
                    })
                    if (error.tokenGone) yield* devices.dropToken(delivery.token)
                  }))
              )
            }), { concurrency: 4, discard: true })
          yield* logged(push, flow, pushed, true)
        }).pipe(
          // No home, no iPhone to push to: the activities live there too.
          Effect.catchTag("HomeOffline", (error) => Effect.logDebug(`push skipped: ${error.message}`))
        )

      return {
        send: (pushes) => Effect.forEach(pushes, (push) => one(push, null), { discard: true }),
        sendTo: (deviceId, pushes) => Effect.forEach(pushes, (push) => one(push, deviceId), { discard: true })
      }
    })
  )
}
