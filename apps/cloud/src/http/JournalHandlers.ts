import { defaultJournalPage, JournalSource, QuaiApi } from "@quai/api"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Journal } from "../journal/Journal.ts"

const isSource = Schema.is(JournalSource)

/** `radarr,sonarr` → the sources it names; unknown names are left out. */
export const sourcesOf = (list: string | undefined) => (list ?? "").split(",").map((s) => s.trim()).filter(isSource)

/** The console's Journal: `/console-api/journal`, history from Quai Home, and the live tail. */
export const JournalHandlers = HttpApiBuilder.group(QuaiApi, "consoleJournal", (handlers) =>
  Effect.gen(function*() {
    const journal = yield* Journal
    return handlers
      .handle("history", ({ query }) => {
        const sources = sourcesOf(query.source)
        return journal.history({
          limit: query.limit ?? defaultJournalPage,
          ...(query.before === undefined ? {} : { before: query.before }),
          ...(sources.length === 0 ? {} : { sources }),
          ...(query.level === undefined ? {} : { level: query.level }),
          ...(query.subject === undefined ? {} : { subject: query.subject }),
          ...(query.search === undefined || query.search.trim() === "" ? {} : { search: query.search })
        })
      })
      .handle("since", ({ query }) => journal.since(query.cursor))
  }))
