import { describe, expect, it } from "@effect/vitest"
import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { Effect, FileSystem, Logger } from "effect"
import { createPublicKey, randomBytes, verify } from "node:crypto"
import { statSync } from "node:fs"
import { join } from "node:path"
import { HomeKey } from "../src/HomeKey.ts"
import { HomeStore } from "../src/HomeStore.ts"
import { NodeFileSystem, tempDir } from "./config.ts"

const inTemp = <A, E>(test: (dir: string) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.flatMap(tempDir, test).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer))

describe("home key", () => {
  it.effect("is created once (mode 0600), then reused", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const path = join(dir, "data", "home.key")
        const first = yield* HomeKey.make(path)
        expect(statSync(path).mode & 0o777).toBe(0o600)
        const second = yield* HomeKey.make(path)
        expect(second.publicKey).toBe(first.publicKey)
        expect(second.homeId).toBe(first.homeId)
        expect(second.webhookToken).toBe(first.webhookToken)
        expect(first.homeId).toMatch(/^[0-9a-f]{32}$/)
        expect(first.homeId).toBe(HomeId.homeId(first.publicKey))
        expect(first.webhookToken).toMatch(/^[0-9a-f]{32}$/)

        const other = yield* HomeKey.make(join(dir, "other.key"))
        expect(other.homeId).not.toBe(first.homeId)
        expect(other.webhookToken).not.toBe(first.webhookToken)
      })
    ))

  it.effect("signs the cloud's nonce: the proof verifies against the public key in Hello", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const key = yield* HomeKey.make(join(dir, "home.key"))
        const nonce = randomBytes(32).toString("base64")
        const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" })
        const signature = Buffer.from(key.sign(nonce), "base64")
        expect(verify(null, Buffer.from(HomeProtocol.challengePayload(nonce)), publicKey, signature)).toBe(true)
        expect(verify(null, randomBytes(32), publicKey, signature)).toBe(false)
      })
    ))

  it.effect("refuses a file that isn't a key", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(join(dir, "home.key"), "garbage")
        const error = yield* Effect.flip(HomeKey.make(join(dir, "home.key")))
        expect(error._tag).toBe("HomeKeyError")
      })
    ))
})

describe("home store", () => {
  it.effect("puts, lists by prefix (nested keys included) and deletes", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const store = yield* HomeStore.make(join(dir, "home"))
        yield* store.put("flows/download", { steps: 3 })
        yield* store.put("flows/playback", { steps: 2 })
        yield* store.put("devices/iphone/prefs", { quiet: true })
        yield* store.put("settings", "v")
        yield* store.put("flows/download", { steps: 4 })

        expect(yield* store.list("flows/")).toEqual([
          { key: "flows/download", value: { steps: 4 } },
          { key: "flows/playback", value: { steps: 2 } }
        ])
        expect((yield* store.list("")).map((document) => document.key)).toEqual([
          "devices/iphone/prefs",
          "flows/download",
          "flows/playback",
          "settings"
        ])
        expect(yield* store.list("devices/iphone")).toEqual([{ key: "devices/iphone/prefs", value: { quiet: true } }])

        yield* store.delete("flows/download")
        yield* store.delete("flows/download")
        expect((yield* store.list("flows")).map((document) => document.key)).toEqual(["flows/playback"])

        const fs = yield* FileSystem.FileSystem
        expect(yield* fs.readFileString(join(dir, "home", "flows", "playback.json"))).toBe("{\"steps\":2}")
        // No temp file left behind by the atomic writes.
        expect(
          (yield* fs.readDirectory(join(dir, "home"), { recursive: true })).filter((name) => name.endsWith(".tmp"))
        ).toEqual([])
      })
    ))

  it.effect("refuses keys that would escape the store or aren't keys", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const store = yield* HomeStore.make(join(dir, "home"))
        for (const key of ["../escape", "/abs", "a//b", "", "a/", ".hidden", "a/../b", "sp ace"]) {
          expect((yield* Effect.flip(store.put(key, 1))).message).toBe(`invalid key: ${key}`)
          expect((yield* Effect.flip(store.delete(key)))._tag).toBe("StoreError")
        }
        expect(yield* store.list("")).toEqual([])
      })
    ))

  it.effect("skips a document that can't be read, and logs its key, never what it holds", () => {
    const logs: Array<string> = []
    const captured = Logger.layer([Logger.make(({ message }) => {
      logs.push((Array.isArray(message) ? message : [message]).map(String).join(" "))
    })])
    return inTemp((dir) =>
      Effect.gen(function*() {
        const store = yield* HomeStore.make(join(dir, "home"))
        yield* store.put("flows/download", { steps: 3 })
        yield* store.put("flows/playback", { steps: 2 })
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(join(dir, "home", "flows", "playback.json"), "{\"token\":\"secret-")
        yield* fs.makeDirectory(join(dir, "home", "flows", "folder.json"))

        expect(yield* store.list("")).toEqual([{ key: "flows/download", value: { steps: 3 } }])
        expect(logs).toEqual([
          "document flows/folder can't be read: skipped",
          "document flows/playback isn't JSON: skipped"
        ])
      })
    ).pipe(Effect.provide(captured))
  })
})
