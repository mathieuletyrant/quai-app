import type { DayRelease, HomeProtocol } from "@quai/api"
import { Effect, Option } from "effect"
import type { FlowEvent, Subject } from "../flows/Events.ts"
import { dayOf, dayRange } from "../releases/Day.ts"
import { activityItems, allAvailable, type DayInputs, dayReleases, startsAt, summary } from "../releases/Tonight.ts"
import { QueuePage } from "./arr.ts"
import { anyEnabledFlow, type Integration, readJson, type Snapshot, type WatchContext } from "./Integration.ts"
import { RadarrCalendar, radarrCalendarPath, radarrCalendarQueuePath } from "./radarr.ts"
import { SonarrCalendar, sonarrCalendarPath, sonarrCalendarQueuePath } from "./sonarr.ts"

/** One activity for the day: `day:2026-11-20`. */
export const dayKey = (day: string) => `day:${day}`
export const dayOfKey = (key: string) => key.startsWith("day:") ? key.slice(4) : null

export const calendarWatchIds = {
  episodes: "calendar:sonarr",
  movies: "calendar:radarr",
  sonarrQueue: "calendar:sonarr-queue",
  radarrQueue: "calendar:radarr-queue"
} as const

/** Every 5 minutes while the day's activity runs, every 30 otherwise (to know when to start it). */
export const pollSeconds = { running: 300, idle: 1800 } as const

const dayFlows = (context: Pick<WatchContext, "flows">) => context.flows.filter((f) => f.enabled && f.subject === "day")

/** Running activities of day flows. */
const dayActivities = (context: WatchContext) => {
  const ids = new Set(context.flows.filter((f) => f.subject === "day").map((f) => f.id))
  return context.running.filter((a) => ids.has(a.flowId))
}

const subjectOf = (day: string): Subject => ({ kind: "day", key: dayKey(day), title: "Tonight" })

/** The watches of the day: Sonarr's and Radarr's calendars and queues, in the home's day. */
export const calendarWatches = (context: WatchContext): ReadonlyArray<HomeProtocol.Watch> => {
  if (!anyEnabledFlow(context, "day")) return []
  const today = dayOf(context.now, context.timeZone)
  const { start, end } = dayRange(today, context.timeZone)
  const everySeconds = dayActivities(context).some((a) => a.subjectKey === dayKey(today)) ? pollSeconds.running : pollSeconds.idle
  const day = 24 * 3600_000
  return [
    { id: calendarWatchIds.episodes, service: "sonarr" as const, path: sonarrCalendarPath(start, end), everySeconds },
    { id: calendarWatchIds.sonarrQueue, service: "sonarr" as const, path: sonarrCalendarQueuePath, everySeconds },
    // Radarr's dates are days at midnight UTC: a day wider each side, then the home's day is kept.
    { id: calendarWatchIds.movies, service: "radarr" as const, path: radarrCalendarPath(start - day, end + day), everySeconds },
    { id: calendarWatchIds.radarrQueue, service: "radarr" as const, path: radarrCalendarQueuePath, everySeconds }
  ].filter((w) => context.services.includes(w.service))
}

/**
 * What the flows should hear now, from the day's releases: start (at the flow's time, or the first
 * air time if earlier, while something is still awaited), the lines changing, all available, and
 * midnight. Only what changes: nothing for an activity already where it should be.
 */
export const dayEvents = (context: WatchContext, releases: ReadonlyArray<DayRelease> | null): ReadonlyArray<FlowEvent> => {
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
  const here = releases.filter((r) => r.status === "available").length
  const values = { items, here, total: releases.length, detail: summary(releases) }
  const done = allAvailable(releases)
  for (const flow of dayFlows(context)) {
    const activity = running.find((a) => a.flowId === flow.id && a.subjectKey === dayKey(today))
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
 * Tonight's releases, from Sonarr's and Radarr's calendars and queues, polled by Quai Home while
 * a day flow is on. What each read said is kept in memory for the day (and dropped when the day,
 * so the watched path, changes); the heartbeat starts the activity when its time comes and ends it
 * at midnight. Never grabs anything.
 */
export const releases = Effect.sync((): Integration => {
  const read = new Map<string, { readonly path: string; readonly body: unknown }>()

  const inputs = (context: WatchContext): DayInputs | null => {
    const current = new Map(calendarWatches(context).map((w) => [w.id, w.path]))
    const value = <A>(id: string): A | undefined => {
      const r = read.get(id)
      return r !== undefined && current.get(id) === r.path ? r.body as A : undefined
    }
    const got: DayInputs = {
      episodes: value(calendarWatchIds.episodes),
      movies: value(calendarWatchIds.movies),
      sonarrQueue: value(calendarWatchIds.sonarrQueue),
      radarrQueue: value(calendarWatchIds.radarrQueue)
    }
    return got.episodes === undefined && got.movies === undefined ? null : got
  }

  const evaluate = (context: WatchContext): ReadonlyArray<FlowEvent> => {
    const got = inputs(context)
    return dayEvents(context, got === null ? null : dayReleases(dayOf(context.now, context.timeZone), context.timeZone, got))
  }

  const decode = ({ watch, body }: Snapshot): Option.Option<unknown> => {
    switch (watch.id) {
      case calendarWatchIds.episodes:
        return readJson(SonarrCalendar, body)
      case calendarWatchIds.movies:
        return readJson(RadarrCalendar, body)
      case calendarWatchIds.sonarrQueue:
      case calendarWatchIds.radarrQueue:
        return Option.map(readJson(QueuePage, body), (page) => page.records)
      default:
        return Option.none()
    }
  }

  return {
    service: "quai",
    watcher: {
      watches: calendarWatches,
      read: (snapshot, context) =>
        Effect.gen(function*() {
          if (snapshot.status !== 200) return yield* Effect.as(Effect.logWarning(`${snapshot.watch.service} calendar answered HTTP ${snapshot.status}`), [])
          const value = decode(snapshot)
          if (Option.isNone(value)) return yield* Effect.as(Effect.logWarning(`${snapshot.watch.service}: could not read ${snapshot.watch.id}`), [])
          read.set(snapshot.watch.id, { path: snapshot.watch.path, body: value.value })
          return evaluate(context)
        }),
      tick: (context) => Effect.sync(() => evaluate(context))
    },
    actions: {}
  }
})
