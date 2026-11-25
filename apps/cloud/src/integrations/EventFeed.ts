import type { JournalSource } from "@quai/api"
import { Clock, Effect } from "effect"
import type { Journal } from "../journal/Journal.ts"

/** On a first read with nothing in the journal yet, the events of the last hour are taken, not the whole history. */
export const firstLookBackMs = 3600_000

/** How many event ids are remembered: more than a feed's page holds. */
const seenAtMost = 1000

/** An event of a service's feed, as the feed tells it apart and dates it. */
export interface FeedEvent {
  readonly id: string
  /** Epoch milliseconds. */
  readonly at: number
}

/**
 * The events not taken yet: newer than `after` (epoch milliseconds), not seen before. Oldest first,
 * as they happened.
 */
export const unseenSince = <E extends FeedEvent>(
  events: ReadonlyArray<E>,
  after: number,
  seen: ReadonlySet<string>
): ReadonlyArray<E> =>
  events
    .filter((event) => !seen.has(event.id) && event.at > after)
    .sort((left, right) => left.at - right.at)

/**
 * A service's event feed, read again and again (a watch), each event taken once and logged by the
 * caller in the journal. A Cloud that starts again knows where it was from the journal itself:
 * what's newer than its last line of these kinds is new (the last hour, when there is none).
 */
export const eventFeed = (
  journal: Journal["Service"],
  lines: { readonly source: JournalSource; readonly kinds: ReadonlyArray<string> }
) => {
  const seen = new Set<string>()
  let after: number | undefined
  const lastLogged = Effect.gen(function*() {
    const page = yield* journal.history({ limit: 200, sources: [lines.source], kinds: [...lines.kinds] })
    const last = page.entries.find((entry) => lines.kinds.includes(entry.kind))
    return last === undefined ? (yield* Clock.currentTimeMillis) - firstLookBackMs : last.at
  })
  /** The events of one read not taken yet, oldest first; every event read is seen from now on. */
  const fresh = <E extends FeedEvent>(events: ReadonlyArray<E>) =>
    Effect.gen(function*() {
      after ??= yield* lastLogged
      const unseen = unseenSince(events, after, seen)
      for (const event of events) seen.add(event.id)
      if (seen.size > seenAtMost) { for (const id of [...seen].slice(0, seen.size - seenAtMost)) seen.delete(id) }
      return unseen
    })
  return { fresh }
}
