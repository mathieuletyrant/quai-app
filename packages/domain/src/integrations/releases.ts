import { Effect, Option } from "effect"
import type { FlowEvent, Subject } from "../flows/Events.ts"
import { dayOf } from "../home/Day.ts"
import type { Watch } from "../home/HomeLink.ts"
import {
  activityItems,
  allAvailable,
  dayInputs,
  type DayReads,
  dayReads,
  type DayRelease,
  dayReleases,
  type DayValue,
  startsAt,
  summary
} from "../releases/ReleaseDays.ts"
import { anyEnabledFlow, type Integration, readSnapshot, type WatchContext, watchOf } from "./Integration.ts"

/** One activity for the day: `day:2026-11-20`. */
export const dayKey = (day: string) => `day:${day}`
export const dayOfKey = (key: string) => key.startsWith("day:") ? key.slice(4) : null

export const calendarWatchIds: { readonly [K in keyof DayReads]: string } = {
  episodes: "calendar:sonarr",
  movies: "calendar:radarr",
  sonarrQueue: "calendar:sonarr-queue",
  radarrQueue: "calendar:radarr-queue"
}

const dayReadKeys = ["episodes", "sonarrQueue", "movies", "radarrQueue"] as const satisfies ReadonlyArray<
  keyof DayReads
>

/** Every 5 minutes while the day's activity runs, every 30 otherwise (to know when to start it). */
export const pollSeconds = { running: 300, idle: 1800 } as const

const dayFlows = (context: Pick<WatchContext, "flows">) =>
  context.flows.filter((flow) => flow.enabled && flow.subject === "day")

const dayActivities = (context: WatchContext) => {
  const ids = new Set(context.flows.filter((flow) => flow.subject === "day").map((flow) => flow.id))
  return context.running.filter((activity) => ids.has(activity.flowId))
}

const subjectOf = (day: string): Subject => ({ kind: "day", key: dayKey(day), title: "Today" })

/** The watches of the day: its reads (`dayReads`), in the home's day. */
export const calendarWatches = (context: WatchContext): ReadonlyArray<Watch> => {
  if (!anyEnabledFlow(context, "day")) return []
  const today = dayOf(context.now, context.timeZone)
  const everySeconds = dayActivities(context).some((activity) => activity.subjectKey === dayKey(today))
    ? pollSeconds.running
    : pollSeconds.idle
  const reads = dayReads(today, context.timeZone)
  return dayReadKeys
    .map((key) => watchOf(calendarWatchIds[key], reads[key], everySeconds))
    .filter((watch) => context.services.includes(watch.service))
}

/**
 * What the flows should hear now, from the day's releases: start (at the flow's time, or the first
 * air time if earlier, while something is still awaited), the lines changing, all available, and
 * midnight. Only what changes: nothing for an activity already where it should be.
 */
export const dayEvents = (
  context: WatchContext,
  releases: ReadonlyArray<DayRelease> | null
): ReadonlyArray<FlowEvent> => {
  const today = dayOf(context.now, context.timeZone)
  const running = dayActivities(context)
  const events: Array<FlowEvent> = []
  // Midnight: yesterday's activities end where they are.
  for (const activity of running) {
    const day = dayOfKey(activity.subjectKey)
    if (day !== null && day !== today) {
      events.push({ type: "releases.dayOver", flowId: activity.flowId, subject: subjectOf(day) })
    }
  }
  if (releases === null || releases.length === 0) return events
  const items = activityItems(releases)
  const here = releases.filter((release) => release.status === "available").length
  const values = { items, here, total: releases.length, detail: summary(releases) }
  const done = allAvailable(releases)
  for (const flow of dayFlows(context)) {
    const activity = running.find((candidate) => candidate.flowId === flow.id && candidate.subjectKey === dayKey(today))
    if (activity === undefined) {
      const due = context.now >= startsAt(today, context.timeZone, flow.filter.startsAt, releases)
      if (due && !done) events.push({ type: "releases.today", flowId: flow.id, subject: subjectOf(today), values })
      continue
    }
    if (done) {
      events.push({ type: "releases.available", flowId: flow.id, subject: subjectOf(today), values })
    } else if (
      JSON.stringify(activity.values.items) !== JSON.stringify(items) ||
      activity.values.here !== here || activity.values.total !== values.total
    ) {
      events.push({ type: "releases.progress", flowId: flow.id, subject: subjectOf(today), values })
    }
  }
  return events
}

/**
 * Today's releases, from Sonarr's and Radarr's calendars and queues, polled by Quai Home while
 * a day flow is on. What each read said is kept in memory for the day (and dropped when the day,
 * so the watched path, changes); the heartbeat starts the activity when its time comes and ends it
 * at midnight. Never grabs anything.
 */
export const releases = Effect.sync((): Integration => {
  /** What each watch last said, decoded, with the path it was read at. */
  const read = new Map<string, { readonly path: string; readonly value: unknown }>()

  const evaluate = (context: WatchContext): ReadonlyArray<FlowEvent> => {
    const today = dayOf(context.now, context.timeZone)
    // Only what was read for the watches of now: yesterday's calendars don't count.
    const current = new Map(calendarWatches(context).map((watch) => [watch.id, watch.path]))
    const value = <K extends keyof DayReads>(key: K): DayValue<K> | undefined => {
      const found = read.get(calendarWatchIds[key])
      return found !== undefined && current.get(calendarWatchIds[key]) === found.path
        ? found.value as DayValue<K>
        : undefined
    }
    const got = {
      episodes: value("episodes"),
      movies: value("movies"),
      sonarrQueue: value("sonarrQueue"),
      radarrQueue: value("radarrQueue")
    }
    const releases = got.episodes === undefined && got.movies === undefined
      ? null
      : dayReleases(today, context.timeZone, dayInputs(got))
    return dayEvents(context, releases)
  }

  return {
    service: "quai",
    watcher: {
      watches: calendarWatches,
      read: (snapshot, context) =>
        Effect.gen(function*() {
          const key = dayReadKeys.find((readKey) => calendarWatchIds[readKey] === snapshot.watch.id)
          if (key === undefined) return []
          const value = yield* readSnapshot<unknown>(
            dayReads(dayOf(context.now, context.timeZone), context.timeZone)[key],
            snapshot
          )
          if (Option.isNone(value)) return []
          read.set(snapshot.watch.id, { path: snapshot.watch.path, value: value.value })
          return evaluate(context)
        }),
      tick: (context) => Effect.sync(() => evaluate(context))
    },
    actions: {}
  }
})
