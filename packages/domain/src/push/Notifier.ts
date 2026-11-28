import type { DeviceId, Flow } from "@quai/api"
import { Clock, Context, Effect, Layer } from "effect"
import { type Activity, parseActivityKey, type Push } from "../flows/Engine.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { type Delivery, deliveryFor, lastStepDone, notifiesReady, preferenceFor } from "../flows/Targeting.ts"
import { isTestSubject } from "../flows/TestScript.ts"
import { Devices, type PushTarget } from "../home/Devices.ts"
import { Journal } from "../journal/Journal.ts"
import { Apns } from "./Apns.ts"
import { apnsBody } from "./ApnsPayload.ts"
import { sendPlain } from "./PlainNotification.ts"

const iphones = (count: number) => `${count} iPhone${count === 1 ? "" : "s"}`

/**
 * Where an activity's change went: pushed to how many iPhones, how many show it but haven't sent
 * its token yet, how many are quiet, how many got the ready notification instead; and whether
 * Quai Cloud has an APNs key at all.
 */
export interface Reach {
  readonly pushed: number
  readonly configured: boolean
  readonly waiting?: number
  readonly quiet?: number
  readonly notified?: number
}

/** "· pushed to 2 iPhones": where an activity's change went. */
const reach = ({ configured, notified = 0, pushed, quiet = 0, waiting = 0 }: Reach) => {
  if (!configured) return " · not pushed: no APNs key"
  const parts = [
    pushed > 0 ? `pushed to ${iphones(pushed)}` : null,
    waiting > 0 ? `not pushed to ${iphones(waiting)}: no activity token yet` : null,
    quiet > 0 ? `${iphones(quiet)} quiet` : null,
    notified > 0 ? `${iphones(notified)} notified it's ready` : null
  ].filter((part) => part !== null)
  return parts.length === 0 ? " · no iPhone to push to" : ` · ${parts.join(" · ")}`
}

/** What one push did on one iPhone, as the journal counts it. */
type Outcome = "pushed" | "waiting" | "quiet" | "notified" | "none"

/** Why a push went nowhere on an iPhone: it waits for the activity's token, or the iPhone is quiet. */
const missed = (push: Push, flow: Flow, target: PushTarget, shown: boolean): Outcome =>
  shown && target.activityToken === null && push._tag !== "Start"
    ? "waiting"
    : !shown && target.quiet && flow.subject === "media"
    ? "quiet"
    : "none"

const countOf = (outcomes: ReadonlyArray<Outcome>, outcome: Outcome) =>
  outcomes.filter((each) => each === outcome).length

const reachOf = (outcomes: ReadonlyArray<Outcome>): Reach => ({
  configured: true,
  pushed: countOf(outcomes, "pushed"),
  waiting: countOf(outcomes, "waiting"),
  quiet: countOf(outcomes, "quiet"),
  notified: countOf(outcomes, "notified")
})

/** How a push is sent: to which iPhones, journaled or not, and the time its APNs body carries. */
interface Sending {
  readonly only: DeviceId | null
  readonly journaled: boolean
  /** A catch-up carries the time of the state it repeats, so a newer push sent meanwhile wins. */
  readonly stampedAt?: number
  /** A flow test shows on a quiet iPhone too: its user asked for it. */
  readonly honorsQuiet: boolean
}

/**
 * The journal's line for an activity that started, moved to another step or ended; null for an
 * update within its step (a progress), which only changes numbers.
 */
export const activityNote = (
  push: Push,
  flow: Flow,
  previousStep: number | undefined,
  reached: Reach
) => {
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
    text: what.text + reach(reached),
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
  /**
   * Sends one iPhone that just reported an activity's token where that activity is now: what
   * changed before (an import seconds after the grab) had no token to go to. An activity the engine
   * no longer knows is over: it ends at once.
   */
  readonly catchUp: (deviceId: DeviceId, activityKey: string, activity: Activity | undefined) => Effect.Effect<void>
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

      const logged = (push: Push, flow: Flow, reached: Reach) =>
        Effect.suspend(() => {
          const key = push.activity.key
          const note = activityNote(push, flow, loggedStep.get(key), reached)
          if (push._tag === "End") loggedStep.delete(key)
          else loggedStep.set(key, push.activity.stepIndex)
          return note === null ? Effect.void : journal.log(note)
        })

      /** Sends one Live Activity push to one iPhone; false when Apple refused it. */
      const sent = (
        target: PushTarget,
        delivery: Exclude<Delivery, { _tag: "None" }>,
        about: { readonly push: Push; readonly flow: Flow; readonly stampedAt: number }
      ) => {
        const { flow, push } = about
        const step = flow.steps[push.activity.stepIndex]?.id ?? "?"
        const progress = delivery.content.progress === undefined
          ? ""
          : ` ${Math.round(delivery.content.progress * 100)} %`
        return apns.send({
          environment: target.apnsEnvironment,
          deviceToken: delivery.token,
          body: apnsBody(delivery, about.stampedAt),
          // High priority: low priority let iOS hold updates back until the app opened.
          priority: 10
        }).pipe(
          Effect.tap(() =>
            Effect.logInfo(`push ${delivery._tag} ${push.activity.key} ${step}${progress} → ${target.deviceId}`)
          ),
          Effect.as(true),
          Effect.catchTag("ApnsError", (error) =>
            Effect.gen(function*() {
              yield* Effect.logWarning(`APNs refused a ${delivery._tag} for ${target.deviceId}: ${error.reason}`)
              yield* journal.log({
                level: "warn",
                source: "apple",
                kind: "push.refused",
                text: `Apple refused the push to ${target.name}: ${error.reason}${
                  error.tokenGone ? " (its token is gone: dropped)" : ""
                }`,
                subject: push.activity.subjectKey,
                title: push.activity.title,
                flowId: flow.id,
                deviceName: target.name
              })
              if (error.tokenGone) yield* devices.dropToken(delivery.token)
              return false
            }))
        )
      }

      /** The ready notification, for an iPhone whose Live Activity can't say the download is ready. */
      const notifyReady = (push: Push, flow: Flow, target: PushTarget) =>
        target.notificationToken === null
          ? Effect.succeed<Outcome>("none")
          : Effect.as(
            sendPlain({ apns, devices, journal }, [{
              deviceId: target.deviceId,
              name: target.name,
              apnsEnvironment: target.apnsEnvironment,
              token: target.notificationToken
            }], {
              title: push.activity.title,
              body: flow.steps[push.activity.stepIndex]?.label ?? "Ready",
              thread: `ready.${flow.id}`
            }),
            "notified" as const
          )

      /**
       * Keeps the swiped-away marks and `shown` in step with what this delivery did on screen: a
       * Start counts once Apple took it.
       */
      const track = (push: Push, target: PushTarget, delivery: Delivery, delivered: boolean) =>
        Effect.gen(function*() {
          const shownKey = key(target.deviceId, push.activity.key)
          // The activity is over, or shows again: nothing left to keep swiped away.
          if (target.dismissed !== null && (push._tag === "End" || delivery._tag === "Start")) {
            yield* devices.clearDismissed(target.deviceId, push.activity.key)
          }
          if (delivery._tag === "Start" && delivered) shown.add(shownKey)
          if (delivery._tag === "End") shown.delete(shownKey)
        })

      const toTarget = (push: Push, flow: Flow, target: PushTarget, sending: Sending & { readonly now: number }) =>
        Effect.gen(function*() {
          const now = sending.now
          const isShown = shown.has(key(target.deviceId, push.activity.key)) || target.activityToken !== null
          const facts = {
            preferences: target.preferences,
            pushToStartToken: target.pushToStartToken,
            activityToken: target.activityToken,
            shown: isShown,
            dismissed: target.dismissed,
            quiet: sending.honorsQuiet && target.quiet
          }
          const delivery = deliveryFor(push, flow, facts, push._tag === "End" ? push.activity.endedAt ?? now : now)
          if (delivery._tag !== "None") {
            const stampedAt = sending.stampedAt ?? now
            const delivered = yield* sent(target, delivery, { push, flow, stampedAt })
            yield* track(push, target, delivery, delivered)
            return delivered ? "pushed" as const : "none" as const
          }
          yield* track(push, target, delivery, false)
          if (sending.only === null && notifiesReady(push, flow, facts, delivery)) {
            return yield* notifyReady(push, flow, target)
          }
          return missed(push, flow, { ...target, quiet: facts.quiet }, isShown)
        })

      const one = (push: Push, sending: Sending) =>
        Effect.gen(function*() {
          const flow = (yield* flowStore.all).find((candidate) => candidate.id === push.activity.flowId)
          if (flow === undefined) return
          if (!(yield* apns.configured)) {
            if (sending.journaled) yield* logged(push, flow, { pushed: 0, configured: false })
            return
          }
          const now = yield* Clock.currentTimeMillis
          const targets = (yield* devices.targets(push.activity.key)).filter((target) =>
            sending.only === null || target.deviceId === sending.only
          )
          const outcomes = yield* Effect.forEach(
            targets,
            (target) => toTarget(push, flow, target, { ...sending, now }),
            { concurrency: 4 }
          )
          if (sending.journaled) yield* logged(push, flow, reachOf(outcomes))
        }).pipe(
          // No home, no iPhone to push to: the activities live there too.
          Effect.catchTag("HomeOffline", (error) => Effect.logDebug(`push skipped: ${error.message}`))
        )

      /**
       * A token for an activity the engine forgot (it ended, and its linger is over): it is still on
       * the iPhone, stuck where its last push left it. It ends now, done, and goes away.
       */
      const endForgotten = (deviceId: DeviceId, activityKey: string) =>
        Effect.gen(function*() {
          const parsed = parseActivityKey(activityKey)
          if (parsed === null || isTestSubject(parsed.subjectKey)) return
          const flow = (yield* flowStore.all).find((candidate) => candidate.id === parsed.flowId)
          if (flow === undefined || !(yield* apns.configured)) return
          const target = (yield* devices.targets(activityKey)).find((each) => each.deviceId === deviceId)
          if (target === undefined || target.activityToken === null) return
          const now = yield* Clock.currentTimeMillis
          const content = lastStepDone(flow, preferenceFor(target.preferences, flow.id))
          const ended = yield* apns.send({
            environment: target.apnsEnvironment,
            deviceToken: target.activityToken,
            body: apnsBody({ _tag: "End", token: target.activityToken, content, dismissAt: now }, now),
            priority: 10
          }).pipe(Effect.as(true), Effect.catchTag("ApnsError", () => Effect.succeed(false)))
          yield* journal.log({
            level: "info",
            source: "cloud",
            kind: "activity.caughtUp",
            text: `${flow.name}: an activity already over ${
              ended ? "ended" : "could not be ended"
            } on ${target.name}, its token came late`,
            subject: parsed.subjectKey,
            flowId: flow.id,
            deviceName: target.name
          })
        }).pipe(Effect.catchTag("HomeOffline", (error) => Effect.logDebug(`catch-up skipped: ${error.message}`)))

      const everyone: Sending = { only: null, journaled: true, honorsQuiet: true }
      return {
        send: (pushes) => Effect.forEach(pushes, (push) => one(push, everyone), { discard: true }),
        sendTo: (deviceId, pushes) =>
          Effect.forEach(pushes, (push) => one(push, { only: deviceId, journaled: true, honorsQuiet: false }), {
            discard: true
          }),
        catchUp: (deviceId, activityKey, activity) =>
          activity === undefined
            ? endForgotten(deviceId, activityKey)
            : one({ _tag: activity.endedAt === null ? "Update" : "End", activity }, {
              only: deviceId,
              journaled: false,
              honorsQuiet: true,
              ...(activity.pushedAt === null ? {} : { stampedAt: activity.pushedAt })
            })
      }
    })
  )
}
