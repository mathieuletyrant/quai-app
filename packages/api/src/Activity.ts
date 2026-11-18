import { Schema } from "effect"

/** The four Live Activity kinds of v1 (see docs/spec-v1.md). */
export const ActivityKind = Schema.Literals(["download", "playback", "releases", "incident"])
export type ActivityKind = typeof ActivityKind.Type
