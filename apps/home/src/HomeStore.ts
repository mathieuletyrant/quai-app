import { HomeProtocol } from "@quai/api"
import { Context, Effect, FileSystem, Layer } from "effect"
import { randomBytes } from "node:crypto"
import { dirname, join, sep } from "node:path"
import { HomeConfig } from "./Config.ts"
import { StoreError } from "./Errors.ts"

export interface HomeDocument {
  readonly key: string
  readonly value: unknown
}

/**
 * The home's documents (flows, devices, activity state), kept for the cloud, which stores nothing.
 * Quai Home never reads them: one JSON file per key, `flows/download` → `flows/download.json`.
 */
export class HomeStore extends Context.Service<HomeStore, {
  /** Every document whose key starts with `prefix`, sorted by key. */
  readonly list: (prefix: string) => Effect.Effect<ReadonlyArray<HomeDocument>, StoreError>
  /** Writes atomically: a crash leaves the old document or the new one, never half of one. */
  readonly put: (key: string, value: unknown) => Effect.Effect<void, StoreError>
  /** Deleting a missing document is not an error. */
  readonly delete: (key: string) => Effect.Effect<void, StoreError>
}>()("quai-home/HomeStore") {
  static readonly make = (root: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const fail = (message: string) => (cause: unknown) => new StoreError({ message, cause })
      const pathOf = (key: string) =>
        HomeProtocol.isStoreKey(key)
          ? Effect.succeed(join(root, ...key.split("/")) + ".json")
          : Effect.fail(new StoreError({ message: `invalid key: ${key}` }))

      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(fail(`could not create ${root}`)))

      return {
        list: (prefix) =>
          Effect.gen(function*() {
            const files = yield* fs.readDirectory(root, { recursive: true }).pipe(Effect.mapError(fail("could not list documents")))
            const keys = files
              .filter((file) => file.endsWith(".json"))
              .map((file) => file.slice(0, -".json".length).split(sep).join("/"))
              .filter((key) => HomeProtocol.isStoreKey(key) && key.startsWith(prefix))
              .sort()
            return yield* Effect.forEach(keys, (key) =>
              fs.readFileString(join(root, ...key.split("/")) + ".json").pipe(
                Effect.mapError(fail(`could not read ${key}`)),
                Effect.flatMap((text) => Effect.try({ try: () => JSON.parse(text) as unknown, catch: fail(`${key} is not JSON`) })),
                Effect.map((value) => ({ key, value }))
              ))
          }),
        put: (key, value) =>
          Effect.gen(function*() {
            const path = yield* pathOf(key)
            const text = yield* Effect.try({ try: () => JSON.stringify(value), catch: fail(`${key}: value is not JSON`) })
            const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`)
            yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
              Effect.andThen(fs.writeFileString(temp, text ?? "null")),
              Effect.andThen(fs.rename(temp, path)),
              Effect.tapError(() => Effect.ignore(fs.remove(temp, { force: true }))),
              Effect.mapError(fail(`could not write ${key}`))
            )
          }),
        delete: (key) =>
          Effect.flatMap(pathOf(key), (path) =>
            fs.remove(path, { force: true }).pipe(Effect.mapError(fail(`could not delete ${key}`))))
      } satisfies HomeStore["Service"]
    })

  static readonly layer = Layer.effect(
    HomeStore,
    Effect.gen(function*() {
      const { dataDir } = yield* HomeConfig
      return yield* HomeStore.make(join(dataDir, "home"))
    })
  )
}
