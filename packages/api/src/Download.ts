import { Schema } from "effect"

/** Steps of the Download Live Activity, in order. Mirrors `DownloadActivityAttributes.Step` in apps/ios. */
export const DownloadStep = Schema.Literals(["searching", "downloading", "importing", "available"])
export type DownloadStep = typeof DownloadStep.Type

/** What the Live Activity shows. Pushed as APNs `content-state`; field names are the iOS `ContentState`'s. */
export const DownloadContentState = Schema.Struct({
  step: DownloadStep,
  progress: Schema.NullOr(Schema.Number),
  bytesPerSecond: Schema.NullOr(Schema.Number),
  remainingSeconds: Schema.NullOr(Schema.Number),
  stalled: Schema.Boolean
})
export type DownloadContentState = typeof DownloadContentState.Type

/** Fixed for the activity's life. Pushed as APNs `attributes` on start. */
export const DownloadAttributes = Schema.Struct({
  mediaKey: Schema.String,
  title: Schema.String
})
export type DownloadAttributes = typeof DownloadAttributes.Type
