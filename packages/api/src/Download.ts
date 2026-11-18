import { Schema } from "effect"

/** Steps of the Download Live Activity, in order. Mirrors `DownloadActivityAttributes.Step` in apps/ios. */
export const DownloadStep = Schema.Literals(["searching", "downloading", "importing", "available"]).annotate({ identifier: "DownloadStep" })
export type DownloadStep = typeof DownloadStep.Type

/**
 * What the Live Activity shows. Pushed as APNs `content-state`; field names are the iOS
 * `ContentState`'s. Unknown values are left out rather than null: Swift reads a missing key as nil,
 * and swift-openapi-generator doesn't support `anyOf [X, null]`.
 */
export const DownloadContentState = Schema.Struct({
  step: DownloadStep,
  progress: Schema.optionalKey(Schema.Finite),
  bytesPerSecond: Schema.optionalKey(Schema.Finite),
  remainingSeconds: Schema.optionalKey(Schema.Finite),
  stalled: Schema.Boolean
}).annotate({ identifier: "DownloadContentState" })
export type DownloadContentState = typeof DownloadContentState.Type

/** Fixed for the activity's life. Pushed as APNs `attributes` on start. */
export const DownloadAttributes = Schema.Struct({
  mediaKey: Schema.String,
  title: Schema.String
}).annotate({ identifier: "DownloadAttributes" })
export type DownloadAttributes = typeof DownloadAttributes.Type
