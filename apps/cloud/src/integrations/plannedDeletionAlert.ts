import { Effect, Option } from "effect"
import { type AlertState, alertState, type Raised } from "../alerts/Alerts.ts"
import { dismissedKey } from "../fixes/Fixes.ts"
import * as FixId from "../fixes/FixId.ts"
import { HomeDocuments } from "../home/HomeLink.ts"
import { type Integration, readSnapshot, watchOf } from "./Integration.ts"
import { type Candidate, candidatesRead, type PlannedCandidate, plannedDeletions, reasonSummary } from "./reclaimerr.ts"

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
export const deletionsState = (candidates: ReadonlyArray<Candidate>, dismissed: ReadonlySet<number>, now: number): AlertState =>
  alertState(
    "deletionPlanned",
    "reclaimerr",
    plannedDeletions(candidates).filter(({ candidate }) => !dismissed.has(candidate.id)).map((planned) => deletionRaised(planned, now))
  )

/** Reclaimerr's candidates every minute, while the Planned deletion alert is on. */
export const plannedDeletionAlert = Effect.gen(function*() {
  const documents = yield* HomeDocuments

  const letGo = (candidates: ReadonlyArray<Candidate>) =>
    Effect.map(
      Effect.forEach(candidates, (candidate) =>
        documents.get(dismissedKey(FixId.deletion(candidate.id))).pipe(
          Effect.map((doc) => Option.isSome(doc) ? [candidate.id] : []),
          Effect.orElseSucceed(() => [])
        )),
      (ids) => new Set(ids.flat())
    )

  const integration: Integration = {
    service: "quai",
    alertWatcher: {
      watches: (context) =>
        context.alerts.deletionPlanned.enabled && context.services.includes("reclaimerr")
          ? [watchOf(deletionsWatchId, candidatesRead, deletionsEverySeconds)]
          : [],
      read: (snapshot, context) =>
        Effect.gen(function*() {
          const page = yield* readSnapshot(candidatesRead, snapshot)
          if (Option.isNone(page)) return []
          return [deletionsState(page.value.items, yield* letGo(page.value.items), context.now)]
        })
    },
    actions: {}
  }
  return integration
})
