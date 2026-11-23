import type { HomeProtocol } from "@quai/api"
import { Data } from "effect"

/** A service did not answer, refused Quai Home, or isn't configured. */
export class ServiceError extends Data.TaggedError("ServiceError")<{
  readonly service: HomeProtocol.HomeService
  readonly message: string
  readonly cause?: unknown
}> {}

/** The home key couldn't be read or created. */
export class HomeKeyError extends Data.TaggedError("HomeKeyError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** A home document couldn't be read or written, or its key is invalid. */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** The console's request can't reach Quai Cloud: no `QUAI_CLOUD_URL`, not linked, or no answer in time. */
export class CloudUnreachable extends Data.TaggedError("CloudUnreachable")<{
  readonly message: string
}> {}
