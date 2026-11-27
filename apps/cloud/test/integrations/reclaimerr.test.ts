import { describe, expect, it } from "@effect/vitest"
import {
  CandidatePage,
  deletionRun,
  type DeletionTask,
  deletionTaskRead,
  plannedDeletions
} from "@quai/domain/integrations/reclaimerr.ts"
import { Schema } from "effect"
import { fixture } from "../fixtures.ts"

const at = (iso: string) => Date.parse(iso) / 1000

/** Reclaimerr's default: every day at 02:00, its next run tomorrow. */
const daily: DeletionTask = {
  enabled: true,
  schedule_type: "cron",
  schedule_value: "0 2 * * *",
  next_run_at: "2026-11-27T02:00:00Z"
}

describe("when Reclaimerr deletes a candidate", () => {
  it("at the deletion task's run after the delay ends, not when it ends", () => {
    // The delay ended at 10:00, after the 02:00 run: the next one takes it.
    expect(deletionRun(at("2026-11-26T10:00:00Z"), daily)).toEqual({ at: at("2026-11-27T02:00:00Z"), exact: true })
    // Already eligible, its date past: the next run too.
    expect(deletionRun(at("2026-11-20T10:00:00Z"), daily)).toEqual({ at: at("2026-11-27T02:00:00Z"), exact: true })
  })

  it("a delay ending after the next run: the cron's first run from then on", () => {
    expect(deletionRun(at("2026-11-30T10:00:00Z"), daily)).toEqual({ at: at("2026-12-01T02:00:00Z"), exact: true })
    // Ending right at a run: that run.
    expect(deletionRun(at("2026-11-30T02:00:00Z"), daily)).toEqual({ at: at("2026-11-30T02:00:00Z"), exact: true })
    const weekly = { ...daily, schedule_value: "0 2 * * sun", next_run_at: "2026-11-29T02:00:00Z" }
    expect(deletionRun(at("2026-11-30T10:00:00Z"), weekly)).toEqual({ at: at("2026-12-06T02:00:00Z"), exact: true })
  })

  it("an interval: the next run, then every interval", () => {
    const quarterly = {
      ...daily,
      schedule_type: "interval",
      schedule_value: "900",
      next_run_at: "2026-11-26T10:15:00Z"
    }
    expect(deletionRun(at("2026-11-26T11:00:30Z"), quarterly)).toEqual({ at: at("2026-11-26T11:15:00Z"), exact: true })
  })

  it("the task off, or run by hand only: nothing goes on its own", () => {
    expect(deletionRun(at("2026-11-26T10:00:00Z"), { ...daily, enabled: false })).toBeUndefined()
    expect(deletionRun(at("2026-11-26T10:00:00Z"), { ...daily, schedule_type: "manual", schedule_value: "" }))
      .toBeUndefined()
  })

  it("a schedule Quai can't follow: the day the delay ends, at the earliest", () => {
    const due = at("2026-11-30T10:00:00Z")
    const earliest = { at: due, exact: false }
    // No task read (a key without tasks:read, an older Quai Home).
    expect(deletionRun(due, undefined)).toEqual(earliest)
    // No next run known.
    expect(deletionRun(due, { ...daily, next_run_at: null })).toEqual(earliest)
    // A cron Quai can't parse, or whose next run isn't one of its own (Reclaimerr's clock not in UTC).
    expect(deletionRun(due, { ...daily, schedule_value: "every night" })).toEqual(earliest)
    expect(deletionRun(due, { ...daily, next_run_at: "2026-11-27T01:00:00Z" })).toEqual(earliest)
    expect(deletionRun(due, { ...daily, schedule_type: "interval", schedule_value: "0" })).toEqual(earliest)
    expect(deletionRun(due, { ...daily, schedule_type: "interval", schedule_value: "Infinity" })).toEqual(earliest)
    // A next run after the delay ends is trusted only from a schedule Quai can follow.
    const after = { ...daily, next_run_at: "2026-12-01T02:00:00Z" }
    expect(deletionRun(due, { ...after, schedule_value: "every night" })).toEqual(earliest)
    expect(deletionRun(due, { ...after, schedule_type: "interval", schedule_value: "1e999" })).toEqual(earliest)
  })

  it("planned deletions take the task's run, and none while the task is off", () => {
    const { items } = Schema.decodeUnknownSync(CandidatePage)(fixture("reclaimerr/candidates.json"))
    const task = Schema.decodeUnknownSync(deletionTaskRead.schema)(fixture("reclaimerr/deletion-task.json"))
    expect(plannedDeletions(items, task).map(({ candidate, deletesAt, exact }) => [candidate.title, deletesAt, exact]))
      .toEqual([
        // Cars 2's delay ended long ago: Reclaimerr's next run takes it.
        ["Cars 2", at("2026-11-19T02:00:00Z"), true],
        ["Up", at("2026-11-25T02:00:00Z"), true]
      ])
    expect(plannedDeletions(items, { ...task, enabled: false })).toEqual([])
  })

  it("a candidate Reclaimerr holds (`blocked`, since 0.6.19) is not planned, whatever its date", () => {
    // Reclaimerr 0.6.19 (jessielw/Reclaimerr#556): a candidate a protection or a pending request holds
    // reads `blocked`, with its `auto_delete_blockers`; before, it stayed `eligible` and never went.
    const candidate = {
      id: 7,
      media_type: "series",
      title: "Vampire Diaries",
      scope: "series",
      reason: "Fully watched seasons",
      auto_delete_eligible_at: "2026-11-25T00:00:00Z",
      blockers: [],
      auto_delete_blockers: [{ code: "active_protection", scope: "season", target_id: 8, season_number: 8 }]
    }
    const { items } = Schema.decodeUnknownSync(CandidatePage)({
      items: [{ ...candidate, auto_delete_state: "blocked" }, {
        ...candidate,
        id: 8,
        scope: "season",
        season_number: 7,
        auto_delete_state: "eligible",
        auto_delete_blockers: []
      }]
    })
    expect(plannedDeletions(items, daily).map(({ candidate }) => candidate.id)).toEqual([8])
  })
})
