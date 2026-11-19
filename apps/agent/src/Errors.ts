import type { AgentProtocol } from "@quai/api"
import { Data } from "effect"

/** A service did not answer, refused the agent, or isn't configured. */
export class ServiceError extends Data.TaggedError("ServiceError")<{
  readonly service: AgentProtocol.AgentService
  readonly message: string
  readonly cause?: unknown
}> {}
