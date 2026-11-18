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
  title: Schema.String,
  /** The steps this activity shows, in order, for the iPhone's stepper. `available` is always last. */
  steps: Schema.optionalKey(Schema.Array(DownloadStep))
}).annotate({ identifier: "DownloadAttributes" })
export type DownloadAttributes = typeof DownloadAttributes.Type

/** How the Download Live Activity behaves on one iPhone (app → Settings → Live Activities). */
export const DownloadPreferences = Schema.Struct({
  enabled: Schema.Boolean,
  /** Steps that get a push. `available` is always shown: it ends the activity. */
  steps: Schema.Array(DownloadStep),
  /** How long the activity stays on the Lock Screen once the title is ready. */
  lingerMinutes: Schema.Literals([15, 60])
}).annotate({ identifier: "DownloadPreferences" })
export type DownloadPreferences = typeof DownloadPreferences.Type

export const defaultDownloadPreferences: DownloadPreferences = {
  enabled: true,
  steps: ["searching", "downloading", "importing", "available"],
  lingerMinutes: 15
}
