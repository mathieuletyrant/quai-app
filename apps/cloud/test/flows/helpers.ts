import { builtInFlows, type Flow } from "@quai/api"
import { Activities } from "@quai/domain/flows/Activities.ts"
import type { FlowEvent, Subject } from "@quai/domain/flows/Events.ts"
import { FlowStore } from "@quai/domain/flows/FlowStore.ts"
import { HomeDocuments } from "@quai/domain/home/HomeLink.ts"
import { Effect, Layer, Option } from "effect"

export const download = builtInFlows.find((flow) => flow.id === "download")!
export const playback = builtInFlows.find((flow) => flow.id === "playback")!
export const requestFlow = builtInFlows.find((flow) => flow.id === "request")!

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

/** A FlowStore that serves fixed flows, for engine tests without a home. */
export const fixedFlows = (flows: ReadonlyArray<Flow> = builtInFlows) =>
  Layer.succeed(FlowStore, {
    all: Effect.succeed(flows),
    get: (id) => Effect.succeed(Option.fromNullishOr(flows.find((flow) => flow.id === id))),
    save: (flow) => Effect.succeed(flow),
    remove: () => Effect.succeed(false),
    reset: () => Effect.succeed(Option.none())
  })

/** The engine on fixed flows, its state in in-memory home documents. */
export const engineWith = (flows: ReadonlyArray<Flow> = builtInFlows) =>
  Activities.layer.pipe(Layer.provide([HomeDocuments.memory, fixedFlows(flows)]))
