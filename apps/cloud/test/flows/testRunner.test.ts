import type { DeviceId } from "@quai/api"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { TestRunner } from "../../src/flows/TestRunner.ts"
import { Notifier } from "../../src/push/Notifier.ts"
import { fixedFlows } from "./helpers.ts"

describe("flow tests", () => {
  const sent: Array<string> = []
  const layer = TestRunner.layer.pipe(Layer.provide([
    fixedFlows(),
    Layer.succeed(Notifier, {
      send: () => Effect.void,
      sendTo: (deviceId, pushes) => Effect.sync(() => pushes.forEach((push) => sent.push(`${deviceId}:${push._tag}`)))
    })
  ]))
  const phone = "phone" as DeviceId
  const ipad = "ipad" as DeviceId

  it.effect("plays on the chosen iPhones only, start to end, in the background", () =>
    Effect.gen(function*() {
      const runner = yield* TestRunner
      expect(Option.isSome(yield* runner.play("download", [phone, ipad]))).toBe(true)
      yield* TestClock.adjust("2 minutes")
      const on = (device: string) => sent.filter((line) => line.startsWith(`${device}:`)).map((line) => line.split(":")[1])
      expect(new Set(sent.map((line) => line.split(":")[0]))).toEqual(new Set(["phone", "ipad"]))
      expect(on("phone")).toEqual(on("ipad"))
      expect(on("phone")[0]).toBe("Start")
      expect(on("phone").at(-1)).toBe("End")
    }).pipe(Effect.provide(layer)))

  it.effect("an unknown flow plays nothing", () =>
    Effect.gen(function*() {
      expect(Option.isNone(yield* (yield* TestRunner).play("nope", [phone]))).toBe(true)
    }).pipe(Effect.provide(layer)))
})
