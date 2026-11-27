import {
  CurrentDevice,
  HomeProtocol,
  type JournalEntry,
  journalId,
  type JournalNote,
  type JournalPage,
  journalPage,
  type JournalQuery,
  type JournalTail
} from "@quai/api"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { randomBytes } from "node:crypto"
import { HomeLink } from "../home/HomeLink.ts"

export const Timing = {
  /** Lines are handed to Quai Home in batches, this often. */
  batchMs: 1_500,
  /** The live view's memory: the last lines, Quai Home's own included. */
  tail: 200,
  /** Lines kept for Quai Home while it's offline, handed over when it's back. */
  waiting: 1_000
} as const

/** Why an action failed, in words. */
const reasonOf = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error)
  if ("message" in error && typeof error.message === "string" && error.message !== "") return error.message
  if ("_tag" in error && error._tag === "NotFound") return "it's no longer there"
  return "_tag" in error ? String(error._tag) : "failed"
}

/**
 * What Quai did, for the console's Journal: every line is in memory for the live view (the last
 * 200), and handed to Quai Home in batches, which keeps 7 days of it on its disk. Quai Cloud keeps
 * nothing: a restarted Cloud reads the history back from Quai Home. A Home too old for a journal
 * (protocol 3 and before) leaves only the memory.
 */
export class Journal extends Context.Service<Journal, {
  /** One line, now. Never fails. */
  readonly log: (note: JournalNote) => Effect.Effect<void>
  /**
   * Runs an action and logs it with how it went: `note` as is when it succeeds, a warning with the
   * reason when it fails. Pressed from an iPhone, the line names it.
   */
  readonly outcome: <A, E, R>(note: JournalNote, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Lines Quai Home wrote itself: for the live view only, Quai Home keeps them already. */
  readonly noted: (entries: ReadonlyArray<JournalEntry>) => Effect.Effect<void>
  /** A page of the history: Quai Home's, or the memory's while it can't answer. */
  readonly history: (query: JournalQuery) => Effect.Effect<JournalPage>
  /** What came in after `cursor` (everything in memory without one, or from a Cloud since restarted). */
  readonly since: (cursor: string | undefined) => Effect.Effect<JournalTail>
  /** Hands Quai Home what waits, now. */
  readonly flush: Effect.Effect<void>
}>()("quai/Journal") {
  static readonly make = Effect.gen(function*() {
    const link = yield* HomeLink
    // A cursor from before a restart means nothing: it starts over.
    const boot = randomBytes(4).toString("hex")
    const tail: Array<{ readonly seq: number; readonly entry: JournalEntry }> = []
    let seq = 0
    let counter = 0
    let waiting: Array<JournalEntry> = []
    const scope = yield* Effect.scope
    /** A batch is on its way: the next lines join it. Nothing runs while nothing is logged. */
    let scheduled = false

    const remember = (entry: JournalEntry) => {
      tail.push({ seq: ++seq, entry })
      if (tail.length > Timing.tail) tail.splice(0, tail.length - Timing.tail)
    }

    const log = (note: JournalNote) =>
      Effect.gen(function*() {
        const at = yield* Clock.currentTimeMillis
        const entry: JournalEntry = { ...note, id: journalId(at, "c", counter++), at }
        remember(entry)
        waiting.push(entry)
        if (waiting.length > Timing.waiting) waiting.splice(0, waiting.length - Timing.waiting)
        if (scheduled) return
        scheduled = true
        yield* Effect.forkIn(
          Effect.sleep(Timing.batchMs).pipe(
            Effect.andThen(Effect.sync(() => (scheduled = false))),
            Effect.andThen(flush)
          ),
          scope
        )
      })

    const keepsJournal = Effect.map(
      link.home,
      (home) => Option.isSome(home) && home.value.protocol >= HomeProtocol.journalProtocolVersion
    )

    const flush: Effect.Effect<void> = Effect.gen(function*() {
      if (waiting.length === 0) return
      const home = yield* link.home
      // Offline: kept for when it's back. Too old: it can't keep them, the memory does.
      if (Option.isNone(home)) return
      const batch = waiting
      waiting = []
      if (home.value.protocol < HomeProtocol.journalProtocolVersion) return
      yield* link.appendJournal(batch).pipe(
        Effect.catchTag("HomeError", () =>
          Effect.sync(() => {
            waiting = [...batch, ...waiting].slice(-Timing.waiting)
          }))
      )
    })

    const fromMemory = (query: JournalQuery): JournalPage => ({
      ...journalPage(tail.map((logged) => logged.entry), query),
      kept: "memory"
    })

    return {
      log,
      outcome: (note, effect) =>
        Effect.gen(function*() {
          const device = yield* Effect.serviceOption(CurrentDevice)
          const by = Option.isSome(device) && note.deviceName === undefined ? { deviceName: device.value.name } : {}
          return yield* effect.pipe(
            Effect.tap(() => log({ ...note, ...by })),
            Effect.tapError((error) =>
              log({
                ...note,
                ...by,
                level: "warn",
                kind: `${note.kind}.failed`,
                text: `${note.text}: failed, ${reasonOf(error)}`
              })
            )
          )
        }),
      noted: (entries) => Effect.sync(() => entries.forEach(remember)),
      history: (query) =>
        Effect.gen(function*() {
          if (!(yield* keepsJournal)) return fromMemory(query)
          // What waits goes first: Quai Home reads after it appends, in the order sent.
          yield* flush
          return yield* link.readJournal(query).pipe(
            Effect.map((page): JournalPage => ({ ...page, kept: "home" })),
            Effect.catchTag("HomeError", () => Effect.succeed(fromMemory(query)))
          )
        }),
      since: (cursor) =>
        Effect.sync(() => {
          const [from, sequence] = (cursor ?? "").split(".")
          const after = from === boot && sequence !== undefined && /^\d+$/.test(sequence) ? Number(sequence) : 0
          return {
            entries: tail.filter((logged) => logged.seq > after).map((logged) => logged.entry),
            cursor: `${boot}.${seq}`
          }
        }),
      flush
    } satisfies Journal["Service"]
  })

  static readonly layer = Layer.effect(Journal, Journal.make)
}
