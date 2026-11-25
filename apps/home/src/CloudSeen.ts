import { Context, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { join } from "node:path"
import { cloudHttpUrl, HomeConfig } from "./Config.ts"

const Seen = Schema.fromJsonString(Schema.Struct({ url: Schema.String }))

/**
 * The Quai Cloud this home last linked to, in `/data/cloud.json`. The paired iPhones talk to it:
 * when `QUAI_CLOUD_URL` now names another Cloud, they must be paired again, and the console says
 * so until the change is acknowledged.
 */
export class CloudSeen extends Context.Service<CloudSeen, {
  /** The Cloud linked before, when it isn't the current one. */
  readonly previous: Effect.Effect<Option.Option<string>>
  /** The current Cloud welcomed this home: remembered, unless an earlier one still waits to be acknowledged. */
  readonly linked: Effect.Effect<void>
  /** The iPhones are paired again: the current Cloud is the one they know. */
  readonly acknowledge: Effect.Effect<void>
}>()("quai-home/CloudSeen") {
  static readonly make = (path: string, cloudUrl: string | null) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const current = cloudUrl === null ? null : cloudHttpUrl(cloudUrl)
      const stored = yield* fs.readFileString(path).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Seen)),
        Effect.map((seen) => seen.url),
        Effect.option
      )
      const seen = yield* Ref.make(stored)
      const remember = (url: string) =>
        Effect.andThen(
          Ref.set(seen, Option.some(url)),
          fs.writeFileString(path, JSON.stringify({ url })).pipe(
            Effect.catch((error) => Effect.logWarning(`could not write ${path}`, error))
          )
        )
      return {
        previous: Effect.map(Ref.get(seen), (url) =>
          Option.filter(url, (seenUrl) => current !== null && seenUrl !== current)),
        linked: Effect.flatMap(Ref.get(seen), (url) =>
          current === null || Option.isSome(url) ? Effect.void : remember(current)),
        acknowledge: current === null ? Effect.void : remember(current)
      } satisfies CloudSeen["Service"]
    })

  static readonly layer = Layer.effect(
    CloudSeen,
    Effect.gen(function*() {
      const { dataDir, cloudUrl } = yield* HomeConfig
      return yield* CloudSeen.make(join(dataDir, "cloud.json"), cloudUrl)
    })
  )
}
