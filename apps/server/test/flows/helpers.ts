import { builtInFlows, type Flow } from "@quai/api"
import { Effect, Layer, Option } from "effect"
import { Activities } from "../../src/flows/Activities.ts"
import type { FlowEvent, Subject } from "../../src/flows/Events.ts"
import { FlowStore } from "../../src/flows/FlowStore.ts"
import { StateStore } from "../../src/store/StateStore.ts"

export const download = builtInFlows.find((f) => f.id === "download")!
export const playback = builtInFlows.find((f) => f.id === "playback")!
export const incident = builtInFlows.find((f) => f.id === "incident")!

export const dune: Subject = { kind: "media", key: "movie:tmdb:1", title: "Dune", mediaType: "movie" }

export const ev = {
  added: (subject: Subject = dune): FlowEvent => ({ type: "media.added", subject }),
  grabbed: (downloadId = "abc", subject: Subject = dune): FlowEvent => ({ type: "media.grabbed", subject, downloadId }),
  progress: (progress: number, downloadId = "abc"): FlowEvent => ({
    type: "download.progress",
    downloadId,
    values: { progress, bytesPerSecond: 1000, remainingSeconds: 60 }
  }),
  imported: (subject: Subject = dune): FlowEvent => ({ type: "media.imported", subject }),
  available: (subject: Subject = dune): FlowEvent => ({ type: "media.available", subject })
}

/** A FlowStore that serves fixed flows, for engine tests without a database. */
export const fixedFlows = (flows: ReadonlyArray<Flow> = builtInFlows) =>
  Layer.succeed(FlowStore, {
    all: Effect.succeed(flows),
    get: (id) => Effect.succeed(Option.fromNullishOr(flows.find((f) => f.id === id))),
    save: (f) => Effect.succeed(f),
    remove: () => Effect.succeed(false),
    reset: () => Effect.succeed(Option.none())
  })

export const engineWith = (flows: ReadonlyArray<Flow> = builtInFlows) =>
  Activities.layerPersisted.pipe(Layer.provide([StateStore.memory, fixedFlows(flows)]))
