import { CurrentDevice, InvalidPairingCode, QuaiApi } from "@quai/api"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { ActionRunner } from "../flows/ActionRunner.ts"
import { Activities } from "../flows/Activities.ts"
import { FlowStore } from "../flows/FlowStore.ts"
import { attributesFor, contentFor, preferenceFor, visibleSteps } from "../flows/Targeting.ts"
import { Devices } from "../store/Devices.ts"

export const DevicesHandlers = HttpApiBuilder.group(QuaiApi, "devices", (handlers) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    const activities = yield* Activities
    const flowStore = yield* FlowStore
    const actions = yield* ActionRunner
    return handlers
      .handle("pair", ({ payload }) =>
        Effect.flatMap(devices.pair(payload), Option.match({
          onNone: () => Effect.fail(new InvalidPairingCode({ message: "This code is unknown, used or expired." })),
          onSome: Effect.succeed
        })))
      .handle("update", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          yield* devices.update(device.id, payload)
        }))
      .handle("activityToken", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          yield* devices.setActivityToken(device.id, payload.mediaKey, payload.pushToken)
        }))
      .handle("preferences", () =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          return yield* devices.preferences(device.id)
        }))
      .handle("savePreferences", ({ payload }) =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          return yield* devices.setPreferences(device.id, payload)
        }))
      .handle("flows", () =>
        Effect.map(flowStore.all, (flows) =>
          flows.map((f) => ({
            id: f.id,
            name: f.name,
            enabled: f.enabled,
            color: f.color,
            icon: f.icon,
            steps: f.steps.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))
          }))))
      .handle("action", ({ payload }) => actions.run(payload.key, payload.action))
      .handle("activities", () =>
        Effect.gen(function*() {
          const device = yield* CurrentDevice
          const preferences = yield* devices.preferences(device.id)
          const flows = yield* flowStore.all
          const { activities: running } = yield* activities.snapshot
          return [...running.values()].flatMap((activity) => {
            const flow = flows.find((f) => f.id === activity.flowId)
            if (flow === undefined) return []
            const preference = preferenceFor(preferences, flow.id)
            if (!preference.enabled || visibleSteps(flow, preference).length === 0) return []
            const content = contentFor(flow, activity, preference)
            return content === null ? [] : [{ attributes: attributesFor(flow, activity, preference), content }]
          })
        }))
  }))
