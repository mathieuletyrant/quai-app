import { HomeProtocol, type JournalNote } from "@quai/api"
import { Effect, Option } from "effect"
import { type AlertState, alertState, type Raised } from "../alerts/Alerts.ts"
import { letGoKey } from "../fixes/Fixes.ts"
import * as FixId from "../fixes/FixId.ts"
import { goneItem, spaceBackText } from "../gone/Gone.ts"
import { HomeDocuments } from "../home/HomeLink.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { Journal } from "../journal/Journal.ts"
import { reachOf, spaceBackOfCarriedOut } from "../upcoming/Upcoming.ts"
import { eventFeed, type FeedEvent } from "./EventFeed.ts"
import { type Integration, readSnapshot, type WatchContext, watchOf } from "./Integration.ts"
import {
  type Candidate,
  candidatesRead,
  carriedOut,
  type DeletionTask,
  type FileEvent,
  fileEventsRead,
  type FileEventType,
  fileEventTypes,
  isMovie,
  type PlannedCandidate,
  plannedDeletions,
  readDeletionTask,
  reasonSummary
} from "./reclaimerr.ts"

/** How often Quai Home reads Reclaimerr's candidates while the alert is on. */
export const deletionsEverySeconds = 60

export const deletionsWatchId = "reclaimerr:candidates"

const dayMs = 24 * 3600_000

/** "in 7 days", "tomorrow", "today": rounded up, so 6 days and 1 hour is "in 7 days". */
const when = (deletesAtMs: number, now: number) => {
  const days = Math.ceil((deletesAtMs - now) / dayMs)
  if (days <= 0) return "today"
  if (days === 1) return "tomorrow"
  return `in ${days} days`
}

/**
 * One planned deletion as an alert: notified when it's planned, then once more on its last day (the
 * alert of the first days ends without a word and the last day's starts). It ends without a
 * notification once Reclaimerr deletes it, the user keeps it or lets it go.
 */
export const deletionRaised = ({ candidate, deletesAt, operation }: PlannedCandidate, now: number): Raised => {
  const deletesAtMs = deletesAt * 1000
  const lastDay = deletesAtMs - now <= dayMs
  const verb = operation === "move" ? "moved" : "deleted"
  return {
    what: `${candidate.id}${lastDay ? ":last-day" : ""}`,
    title: `${candidate.title} will be ${verb} ${when(deletesAtMs, now)}`,
    detail: reasonSummary(candidate.reason),
    over: `${candidate.title}: no ${verb === "moved" ? "move" : "deletion"} planned anymore`,
    silentOver: true
  }
}

/** Every deletion Reclaimerr plans on its own, but those the user let go in Quai. */
export const deletionsState = (
  candidates: ReadonlyArray<Candidate>,
  task: DeletionTask | undefined,
  letGo: ReadonlySet<number>,
  now: number
): AlertState =>
  alertState(
    "plannedDeletion",
    "reclaimerr",
    plannedDeletions(candidates, task).filter(({ candidate }) => !letGo.has(candidate.id)).map((planned) =>
      deletionRaised(planned, now)
    )
  )

/** The feed's watch of one type of file event. */
export const fileEventsWatchId = (type: FileEventType) => `reclaimerr:${type}`

/** How often Quai Home reads Reclaimerr's event feed while an iPhone wants what it carried out. */
export const fileEventsEverySeconds = 60

/** "Deleted by Reclaimerr · 24 GB back", "Moved by Reclaimerr". */
export const carriedOutDetail = (event: FileEvent, spaceBack: number | undefined) =>
  `${event.type === "candidate.moved" ? "Moved" : "Deleted"} by Reclaimerr${spaceBackText(spaceBack)}`

/** The journal's line: "Reclaimerr deleted Vampire Diaries S07 · 24 GB back". */
export const carriedOutNote = (title: string, event: FileEvent, spaceBack: number | undefined): JournalNote => {
  const moved = event.type === "candidate.moved"
  return {
    level: "info",
    source: "reclaimerr",
    kind: moved ? "reclaimerr.moved" : "reclaimerr.deleted",
    text: `Reclaimerr ${moved ? "moved" : "deleted"} ${title}${spaceBackText(spaceBack)}`,
    title
  }
}

/**
 * One event per candidate, across reads: Reclaimerr tells each version of a movie it deletes apart,
 * and they may come in different reads. `taken` keeps the candidates already gone, the oldest
 * forgotten past `knownAtMost`.
 */
export const oncePerCandidate = (events: ReadonlyArray<FileEvent & FeedEvent>, taken: Set<number>) => {
  const once = events.filter((event) => {
    const id = event.payload.candidate_id ?? undefined
    if (id === undefined) return true
    if (taken.has(id)) return false
    taken.add(id)
    return true
  })
  if (taken.size > knownAtMost) { for (const id of [...taken].slice(0, taken.size - knownAtMost)) taken.delete(id) }
  return once
}

/** How long the deletion task's schedule is kept before it is read again: it rarely changes. */
export const deletionTaskEveryMs = 10 * 60_000

/** How many candidates are remembered for their size and name, more than Reclaimerr lists. */
const knownAtMost = 1000

/**
 * A planned deletion, followed: Reclaimerr's candidates every minute while the Planned deletion
 * alert is on or an iPhone wants Gone · Planned deletion (their last size and name are kept, the
 * event feed has neither), and its event feed while an iPhone wants it, on a recent Quai Home.
 */
export const plannedDeletionAlert = Effect.gen(function*() {
  const documents = yield* HomeDocuments
  const reads = yield* HomeReads
  const journal = yield* Journal
  const feed = eventFeed(journal, { source: "reclaimerr", kinds: ["reclaimerr.deleted", "reclaimerr.moved"] })
  const known = new Map<number, Candidate>()
  const carriedOutIds = new Set<number>()
  let task: { readonly value: DeletionTask | undefined; readonly readAt: number } | undefined

  /** The deletion task, read at most every `deletionTaskEveryMs`; undefined when it can't be. */
  const deletionTask = (now: number) =>
    task !== undefined && now - task.readAt < deletionTaskEveryMs
      ? Effect.succeed(task.value)
      : readDeletionTask(reads).pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.tap((value) => Effect.sync(() => (task = { value, readAt: now })))
      )

  const remember = (candidates: ReadonlyArray<Candidate>) => {
    for (const candidate of candidates) {
      known.delete(candidate.id)
      known.set(candidate.id, candidate)
    }
    if (known.size > knownAtMost) {
      for (const id of [...known.keys()].slice(0, known.size - knownAtMost)) known.delete(id)
    }
  }

  const letGo = (candidates: ReadonlyArray<Candidate>) =>
    Effect.map(
      Effect.forEach(candidates, (candidate) =>
        documents.get(letGoKey(FixId.deletion(candidate.id))).pipe(
          Effect.map((doc) => Option.isSome(doc) ? [candidate.id] : []),
          Effect.orElseSucceed(() => [])
        )),
      (ids) => new Set(ids.flat())
    )

  /** What one file event says is gone, logged; the space back read now, nothing when it can't be. */
  const carriedOutGone = (event: FileEvent & FeedEvent, context: WatchContext) =>
    Effect.gen(function*() {
      const candidateId = event.payload.candidate_id ?? undefined
      const planned = carriedOut(event, candidateId === undefined ? undefined : known.get(candidateId), context.now)
      const spaceBack = yield* spaceBackOfCarriedOut(
        reads,
        reachOf({ services: context.services, protocol: protocolOf(context) }),
        planned,
        context.now
      ).pipe(
        Effect.orElseSucceed(() => undefined)
      )
      const title = planned.candidate.title
      yield* journal.log(carriedOutNote(title, event, spaceBack))
      return goneItem({
        kind: "plannedDeletion",
        source: "reclaimerr",
        at: event.at,
        title,
        detail: carriedOutDetail(event, spaceBack),
        ...(spaceBack === undefined || spaceBack <= 0 ? {} : { spaceBack }),
        holds: isMovie(planned.candidate) ? "movies" : "shows",
        ...(event.type === "candidate.moved" ? { moved: true } : {})
      })
    })

  const protocolOf = (context: WatchContext) => context.protocol ?? HomeProtocol.protocolVersion

  /** Its deletions are disk marks (and Gone for the iPhones that want it): read while Quai Home reaches it. */
  const wantsGone = (context: WatchContext) => context.services.includes("reclaimerr")

  const integration: Integration = {
    service: "quai",
    alertWatcher: {
      watches: (context) =>
        (context.alerts.plannedDeletion.enabled || wantsGone(context)) && context.services.includes("reclaimerr")
          ? [watchOf(deletionsWatchId, candidatesRead, deletionsEverySeconds)]
          : [],
      read: (snapshot, context) =>
        Effect.gen(function*() {
          const page = yield* readSnapshot(candidatesRead, snapshot)
          if (Option.isNone(page)) return []
          remember(page.value.items)
          if (!context.alerts.plannedDeletion.enabled) return []
          const schedule = yield* deletionTask(context.now)
          return [deletionsState(page.value.items, schedule, yield* letGo(page.value.items), context.now)]
        })
    },
    goneWatcher: {
      watches: (context) =>
        wantsGone(context) && protocolOf(context) >= HomeProtocol.goneProtocolVersion
          ? fileEventTypes.map((type) =>
            watchOf(fileEventsWatchId(type), fileEventsRead(type, context.now), fileEventsEverySeconds)
          )
          : [],
      read: (snapshot, context) =>
        Effect.gen(function*() {
          const type = fileEventTypes.find((candidate) => fileEventsWatchId(candidate) === snapshot.watch.id)
          if (type === undefined) return []
          const page = yield* readSnapshot(fileEventsRead(type, context.now), snapshot)
          if (Option.isNone(page)) return []
          const dated = page.value.items.map((event) => ({ ...event, at: Date.parse(event.occurred_at) }))
          const fresh = oncePerCandidate(yield* feed.fresh(dated), carriedOutIds)
          return yield* Effect.forEach(fresh, (event) => carriedOutGone(event, context))
        })
    },
    actions: {}
  }
  return integration
})
