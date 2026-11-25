import {
  type JournalEntry,
  JournalEntry as JournalEntrySchema,
  journalId,
  type JournalNote,
  journalPage,
  type JournalQuery
} from "@quai/api"
import { Clock, Context, Effect, FileSystem, Layer, Queue, Schema, Semaphore } from "effect"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { HomeConfig } from "./Config.ts"

/** How long the journal is kept, and at most how many lines. */
export const Retention = {
  days: 7,
  maxEntries: 5000,
  /** Past `maxEntries` by this many, the oldest are pruned (so files aren't rewritten at every line). */
  slack: 250,
  /** Lines wait this long in memory before they're written and synced together. */
  flushMs: 2_000
} as const

const dayMs = 24 * 3600_000

/** The file of a day (UTC): `2026-11-20.jsonl`. */
export const journalFile = (at: number) =>
  `${new Date(Math.floor(at / dayMs) * dayMs).toISOString().slice(0, 10)}.jsonl`
const filePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(JournalEntrySchema))

/** The lines of one file that read as entries; the others are skipped. */
export const parseJournal = (
  text: string
): { readonly entries: ReadonlyArray<JournalEntry>; readonly skipped: number } => {
  const entries: Array<JournalEntry> = []
  let skipped = 0
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const entry = decodeLine(line)
    if (entry._tag === "Some") entries.push(entry.value)
    else skipped++
  }
  return { entries, skipped }
}

const toLines = (entries: ReadonlyArray<JournalEntry>) => entries.map((entry) => JSON.stringify(entry) + "\n").join("")

/**
 * The home's journal, on `/data/journal`: one JSON line per entry, one file per day (UTC), kept 7
 * days and at most 5000 lines. Quai Cloud's lines (`JournalAppend`) and Quai Home's own go to the
 * same files. All of it is held in memory too (a few megabytes at most): reads never touch the
 * disk. Lines are written 2 s after the first of a batch came in, synced once per write, not per
 * line; the oldest are pruned as a new day's lines come in.
 */
export class Journal extends Context.Service<Journal, {
  /** Lines Quai Cloud wrote. An id already kept is skipped. */
  readonly append: (entries: ReadonlyArray<JournalEntry>) => Effect.Effect<void>
  /** A line of Quai Home's own: kept, and handed to the Cloud's live view by `noted`. */
  readonly note: (note: JournalNote) => Effect.Effect<void>
  /** Quai Home's own lines not yet handed to the Cloud, oldest first. Waits for one. */
  readonly noted: Effect.Effect<ReadonlyArray<JournalEntry>>
  readonly read: (
    query: JournalQuery
  ) => Effect.Effect<{ readonly entries: ReadonlyArray<JournalEntry>; readonly more: boolean }>
  /** Writes what waits, now, and prunes what's too old. */
  readonly flush: Effect.Effect<void>
}>()("quai-home/Journal") {
  static readonly make = (root: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const lock = yield* Semaphore.make(1)
      const own = yield* Queue.sliding<JournalEntry>(500)
      const warn = (message: string) => (cause: unknown) => Effect.logWarning(`journal: ${message}`, cause)
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.catch(warn(`could not create ${root}`)))

      // What was kept before, a corrupted line skipped (a crash mid-write leaves half of one).
      const files = (yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))).filter((name) =>
        filePattern.test(name)
      ).sort()
      const entries: Array<JournalEntry> = []
      const ids = new Set<string>()
      let skipped = 0
      for (const file of files) {
        const text = yield* fs.readFileString(join(root, file)).pipe(Effect.orElseSucceed(() => ""))
        const parsed = parseJournal(text)
        skipped += parsed.skipped
        for (const entry of parsed.entries) {
          if (ids.has(entry.id)) continue
          ids.add(entry.id)
          entries.push(entry)
        }
      }
      if (skipped > 0) {
        yield* Effect.logWarning(`journal: skipped ${skipped} unreadable line${skipped === 1 ? "" : "s"}`)
      }
      entries.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

      let pending: Array<JournalEntry> = []
      let counter = 0

      const write = (file: string, text: string, flag: "a" | "w") =>
        Effect.scoped(Effect.gen(function*() {
          const handle = yield* fs.open(join(root, file), { flag })
          yield* handle.writeAll(new TextEncoder().encode(text))
          yield* handle.sync
        }))

      /** Rewrites a file with what's left of it, atomically; removes it when nothing is. */
      const rewrite = (file: string, kept: ReadonlyArray<JournalEntry>) =>
        Effect.gen(function*() {
          const path = join(root, file)
          if (kept.length === 0) return yield* fs.remove(path, { force: true })
          const temp = join(root, `.${randomBytes(6).toString("hex")}.tmp`)
          yield* write(temp.slice(root.length + 1), toLines(kept), "w")
          yield* fs.rename(temp, path)
        })

      /** Drops what's older than 7 days, and the oldest past 5000 lines. */
      const prune = (now: number) =>
        Effect.gen(function*() {
          const cutoff = now - Retention.days * dayMs
          const tooMany = entries.length > Retention.maxEntries + Retention.slack
          const keepFrom = Math.max(
            entries.findIndex((entry) => entry.at >= cutoff) === -1
              ? entries.length
              : entries.findIndex((entry) => entry.at >= cutoff),
            tooMany ? entries.length - Retention.maxEntries : 0
          )
          const dropped = entries.splice(0, keepFrom)
          for (const entry of dropped) ids.delete(entry.id)
          const onDisk = (yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))).filter((name) =>
            filePattern.test(name)
          )
          const touched = new Set(dropped.map((entry) => journalFile(entry.at)))
          const oldest = journalFile(cutoff)
          for (const file of onDisk) {
            if (file < oldest) {
              yield* fs.remove(join(root, file), { force: true }).pipe(Effect.catch(warn(`could not remove ${file}`)))
            } else if (touched.has(file)) {
              // What still waits in memory is appended by the next flush, not written twice.
              const waiting = new Set(pending.map((entry) => entry.id))
              const kept = entries.filter((entry) => journalFile(entry.at) === file && !waiting.has(entry.id))
              yield* rewrite(file, kept).pipe(Effect.catch(warn(`could not prune ${file}`)))
            }
          }
        })

      let prunedDay = ""
      const flush = Semaphore.withPermits(lock, 1)(Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const batch = pending
        pending = []
        const byFile = new Map<string, Array<JournalEntry>>()
        for (const entry of batch) {
          const file = journalFile(entry.at)
          byFile.set(file, [...(byFile.get(file) ?? []), entry])
        }
        for (const [file, lines] of byFile) {
          yield* write(file, toLines(lines), "a").pipe(Effect.catch(warn(`could not write ${file}`)))
        }
        const today = journalFile(now)
        if (today !== prunedDay || entries.length > Retention.maxEntries + Retention.slack) {
          prunedDay = today
          yield* prune(now)
        }
      }))

      const scope = yield* Effect.scope
      /** A write is on its way: the next lines join it. Nothing runs while nothing comes in. */
      let scheduled = false
      const later = Effect.suspend(() => {
        if (scheduled) return Effect.void
        scheduled = true
        return Effect.asVoid(Effect.forkIn(
          Effect.sleep(Retention.flushMs).pipe(
            Effect.andThen(Effect.sync(() => (scheduled = false))),
            Effect.andThen(flush)
          ),
          scope
        ))
      })

      const add = (entry: JournalEntry) => {
        if (ids.has(entry.id)) return false
        ids.add(entry.id)
        // Nearly always the newest: kept sorted without sorting everything.
        let position = entries.length
        while (position > 0 && entries[position - 1]!.id > entry.id) position--
        entries.splice(position, 0, entry)
        pending.push(entry)
        return true
      }

      yield* flush
      yield* Effect.addFinalizer(() => flush)

      return {
        append: (batch) =>
          Effect.andThen(
            Effect.sync(() => {
              for (const entry of batch) add(entry)
            }),
            later
          ),
        note: (note) =>
          Effect.gen(function*() {
            const at = yield* Clock.currentTimeMillis
            const entry: JournalEntry = { ...note, id: journalId(at, "h", counter++), at }
            if (!add(entry)) return
            yield* Queue.offer(own, entry)
            yield* later
          }),
        noted: Effect.map(Queue.takeBetween(own, 1, 100), (chunk) => [...chunk]),
        read: (query) => Effect.sync(() => journalPage(entries, query)),
        flush
      } satisfies Journal["Service"]
    })

  static readonly layer = Layer.effect(
    Journal,
    Effect.gen(function*() {
      const { dataDir } = yield* HomeConfig
      return yield* Journal.make(join(dataDir, "journal"))
    })
  )
}
