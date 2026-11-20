import { describe, expect, it } from "@effect/vitest"
import { type JournalEntry, journalId } from "@quai/api"
import { Effect, FileSystem, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { join } from "node:path"
import { Calls } from "../src/Calls.ts"
import { Journal, journalFile, parseJournal, Retention } from "../src/Journal.ts"
import { ServiceAuth } from "../src/ServiceAuth.ts"
import { configLayer, NodeFileSystem, tempDir } from "./config.ts"
import { fakeHttp } from "./fakeHttp.ts"

const day = 24 * 3600_000
/** Nov 20, 2026, 08:00 UTC. */
const morning = Date.UTC(2026, 10, 20, 8)

let n = 0
const line = (at: number, overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id: journalId(at, "c", n++),
  at,
  level: "info",
  source: "radarr",
  kind: "media.grabbed",
  text: `at ${new Date(at).toISOString()}`,
  ...overrides
})

/** A journal in `dir`, opened in its own scope: closing it flushes, as a stop does. */
const opened = <A, E>(dir: string, use: (journal: Journal["Service"]) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(Journal.make(join(dir, "journal")), use))

const inTemp = <A, E>(test: (dir: string, fs: FileSystem.FileSystem) => Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
  Effect.gen(function*() {
    yield* TestClock.setTime(morning)
    const dir = yield* tempDir
    return yield* test(dir, yield* FileSystem.FileSystem)
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer))

const files = (fs: FileSystem.FileSystem, dir: string) =>
  Effect.map(fs.readDirectory(join(dir, "journal")), (all) => all.filter((f) => !f.startsWith(".")).sort())

describe("home journal", () => {
  it.effect("writes JSON lines in the file of their day 2 s after they came in, and reads them back after a restart", () =>
    inTemp((dir, fs) =>
      Effect.gen(function*() {
        const lateYesterday = line(morning - 9 * 3600_000)
        const today = line(morning)
        yield* opened(dir, (journal) =>
          Effect.gen(function*() {
            yield* journal.append([lateYesterday, today])
            expect(yield* files(fs, dir)).toEqual([])
            yield* TestClock.adjust(Retention.flushMs)
            // Waits for the write the timer started (the disk is real).
            yield* journal.flush
            expect(yield* files(fs, dir)).toEqual(["2026-11-19.jsonl", "2026-11-20.jsonl"])
            const text = yield* fs.readFileString(join(dir, "journal", "2026-11-20.jsonl"))
            expect(text).toBe(JSON.stringify(today) + "\n")
          }))
        const again = yield* opened(dir, (journal) => journal.read({ limit: 10 }))
        expect(again.entries).toEqual([today, lateYesterday])
      })))

  it.effect("flushes what waits when it stops", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        const entry = line(morning)
        yield* opened(dir, (journal) => journal.append([entry]))
        expect((yield* opened(dir, (journal) => journal.read({ limit: 10 }))).entries).toEqual([entry])
      })))

  it.effect("skips a corrupted line and an id it already has", () =>
    inTemp((dir, fs) =>
      Effect.gen(function*() {
        const good = line(morning)
        yield* fs.makeDirectory(join(dir, "journal"), { recursive: true })
        yield* fs.writeFileString(join(dir, "journal", journalFile(morning)), `${JSON.stringify(good)}\n{"id":"half\n${JSON.stringify(good)}\nnot json\n`)
        const page = yield* opened(dir, (journal) => journal.read({ limit: 10 }))
        expect(page.entries).toEqual([good])
        expect(parseJournal("{}\n\n").skipped).toBe(1)
      })))

  it.effect("keeps 7 days: a new day removes the oldest files", () =>
    inTemp((dir, fs) =>
      Effect.gen(function*() {
        const old = line(morning - 7 * day)
        const recent = line(morning - 6 * day)
        yield* opened(dir, (journal) =>
          Effect.gen(function*() {
            yield* journal.append([old, recent])
            yield* journal.flush
            expect(yield* files(fs, dir)).toEqual(["2026-11-13.jsonl", "2026-11-14.jsonl"])
            yield* TestClock.adjust(day)
            yield* journal.append([line(morning + day)])
            yield* journal.flush
            expect(yield* files(fs, dir)).toEqual(["2026-11-14.jsonl", "2026-11-21.jsonl"])
            expect((yield* journal.read({ limit: 10 })).entries.at(-1)).toEqual(recent)
          }))
      })))

  it.effect("keeps at most 5000 lines: the oldest go, their file rewritten", () =>
    inTemp((dir, fs) =>
      Effect.gen(function*() {
        const total = Retention.maxEntries + Retention.slack + 1
        const older = Array.from({ length: 300 }, (_, i) => line(morning - day + i))
        const newer = Array.from({ length: total - 300 }, (_, i) => line(morning + i))
        yield* opened(dir, (journal) =>
          Effect.gen(function*() {
            yield* journal.append([...older, ...newer])
            yield* journal.flush
            const page = yield* journal.read({ limit: 1, before: newer[0]!.id })
            expect(page.entries).toEqual([older.at(-1)])
          }))
        const kept = parseJournal(yield* fs.readFileString(join(dir, "journal", journalFile(older[0]!.at)))).entries
        expect(kept).toHaveLength(Retention.maxEntries - newer.length)
        expect(kept.at(-1)).toEqual(older.at(-1))
        const reopened = yield* opened(dir, (journal) => journal.read({ limit: 200, before: newer[0]!.id }))
        expect(reopened.entries).toHaveLength(Retention.maxEntries - newer.length)
      })))

  it.effect("reads pages newest first with the filters, Cloud's lines and Home's own together", () =>
    inTemp((dir) =>
      opened(dir, (journal) =>
        Effect.gen(function*() {
          const grabbed = line(morning, { subject: "movie:tmdb:1", title: "Dune" })
          yield* journal.append([grabbed])
          yield* TestClock.adjust(1000)
          yield* journal.note({ level: "warn", source: "home", kind: "call.refused", text: "refused" })
          const all = yield* journal.read({ limit: 10 })
          expect(all.entries.map((e) => e.text)).toEqual(["refused", grabbed.text])
          expect(all.entries[0]!.id).toMatch(/-h/)
          expect((yield* journal.read({ limit: 10, level: "warn" })).entries.map((e) => e.text)).toEqual(["refused"])
          expect((yield* journal.read({ limit: 10, subject: "movie:tmdb:1" })).entries).toEqual([grabbed])
          expect((yield* journal.read({ limit: 1 })).more).toBe(true)
          expect(yield* journal.noted).toHaveLength(1)
        }))))
})

describe("home journal lines", () => {
  it.effect("a refused call, a service that stops answering and comes back: once per streak", () =>
    inTemp((dir) =>
      Effect.gen(function*() {
        let up = false
        const http = fakeHttp(() => up ? { json: {} } : { unreachable: true as const }, [])
        const layer = Calls.layer.pipe(
          Layer.provide(ServiceAuth.layer),
          Layer.provideMerge(Layer.effect(Journal, Journal.make(join(dir, "journal")))),
          Layer.provide([configLayer(), http])
        )
        yield* Effect.gen(function*() {
          const calls = yield* Calls
          const journal = yield* Journal
          const status = { _tag: "Call", id: "r", service: "radarr", method: "GET", path: "/api/v3/system/status" } as const
          yield* calls.run({ ...status, path: "/api/v3/config/host?apikey=x" })
          yield* calls.run(status)
          yield* calls.run(status)
          up = true
          yield* calls.run(status)
          yield* calls.run(status)
          const texts = (yield* journal.read({ limit: 10 })).entries.map((e) => `${e.level} ${e.source} ${e.text}`).reverse()
          expect(texts).toEqual([
            "warn radarr Quai Home refused a call outside its allowlist: Radarr GET /api/v3/config/host",
            "warn radarr Quai Home can't reach Radarr: unreachable",
            "info radarr Quai Home reaches Radarr again"
          ])
        }).pipe(Effect.provide(layer))
      })))
})
