import { Schema } from "effect"

/** Les quatre types de Live Activity de la v1 (voir docs/spec-v1.md). */
export const ActivityKind = Schema.Literals(["download", "playback", "releases", "incident"])
export type ActivityKind = typeof ActivityKind.Type
