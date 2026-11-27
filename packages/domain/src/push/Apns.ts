import type { ApnsEnvironment, PushSettings } from "@quai/api"
import { Context, Data, type Effect } from "effect"

export class ApnsError extends Data.TaggedError("ApnsError")<{
  readonly status: number | null
  readonly reason: string
  /** APNs says the token is gone for good: stop sending to it. */
  readonly tokenGone: boolean
}> {}

export interface ApnsRequest {
  /** A Live Activity's update, or a plain notification (an alert). Absent: a Live Activity. */
  readonly pushType?: "liveactivity" | "alert"
  readonly environment: ApnsEnvironment
  readonly deviceToken: string
  readonly body: object
  readonly priority: 5 | 10
}

/**
 * What sends a home's pushes to APNs. The key is Quai Cloud's, never home data: the domain builds
 * each push and names the iPhone's token, and only says whether a key is there.
 */
export class Apns extends Context.Service<Apns, {
  readonly configured: Effect.Effect<boolean>
  /** What the console's Settings page shows: never the key itself. */
  readonly settings: PushSettings
  readonly send: (request: ApnsRequest) => Effect.Effect<void, ApnsError>
}>()("quai/Apns") {}
