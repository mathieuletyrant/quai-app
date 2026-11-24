import { type ActionType, InvalidAction } from "@quai/api"
import { Clock, Effect, Option, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import { type FlowEvent, lookupIds, type MediaLookup } from "../flows/Events.ts"
import { HomeReads } from "../home/HomeReads.ts"
import { actionCall, type ActionHandler, anyEnabledFlow, type Integration, readJson, runningWhere, type WatchContext } from "./Integration.ts"

const Item = Schema.Struct({
  Id: Schema.String,
  ProviderIds: Schema.optional(Schema.Record(Schema.String, Schema.String))
})
export const ItemsResult = Schema.Struct({ Items: Schema.Array(Item) })

const Episode = Schema.Struct({
  ParentIndexNumber: Schema.optional(Schema.Number),
  IndexNumber: Schema.optional(Schema.Number),
  LocationType: Schema.optional(Schema.String)
})
export const EpisodesResult = Schema.Struct({ Items: Schema.Array(Episode) })

const User = Schema.Struct({
  Id: Schema.String,
  Policy: Schema.optional(Schema.Struct({
    IsAdministrator: Schema.optional(Schema.Boolean),
    IsDisabled: Schema.optional(Schema.Boolean)
  }))
})
export const Users = Schema.Array(User)

/**
 * Whose library Quai lists: an administrator's, who sees every library. Without a user, Jellyfin
 * lists only part of it, and leaves out titles just added.
 */
export const libraryUser = (users: typeof Users.Type): string | null => {
  const enabled = users.filter((u) => u.Policy?.IsDisabled !== true)
  return (enabled.find((u) => u.Policy?.IsAdministrator === true) ?? enabled[0])?.Id ?? null
}

const Session = Schema.Struct({
  Id: Schema.String,
  DeviceName: Schema.optional(Schema.String),
  NowPlayingItem: Schema.optional(Schema.Struct({
    Id: Schema.String,
    Name: Schema.String,
    SeriesName: Schema.optional(Schema.String),
    ParentIndexNumber: Schema.optional(Schema.Number),
    IndexNumber: Schema.optional(Schema.Number),
    RunTimeTicks: Schema.optional(Schema.Number)
  })),
  PlayState: Schema.optional(Schema.Struct({
    PositionTicks: Schema.optional(Schema.Number),
    IsPaused: Schema.optional(Schema.Boolean)
  }))
})
export const Sessions = Schema.Array(Session)

/** Something playing on a Jellyfin device, as Quai follows it. */
export interface Playing {
  readonly key: string
  readonly title: string
  readonly device: string
  readonly paused: boolean
  /** Milliseconds left and played, when Jellyfin knows the runtime. */
  readonly remainingMs: number | null
  readonly positionMs: number
  readonly runtimeMs: number | null
}

/** Remote control commands Quai sends to a Jellyfin session. */
export type PlaybackCommand = "PlayPause" | "Stop"

const pad = (n: number) => n.toString().padStart(2, "0")

export const playingFrom = (sessions: typeof Sessions.Type): ReadonlyArray<Playing> =>
  sessions.flatMap((s) => {
    const item = s.NowPlayingItem
    if (item === undefined) return []
    const episode = item.SeriesName !== undefined && item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
      ? `${item.SeriesName} · S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}`
      : null
    const runtime = item.RunTimeTicks
    const position = s.PlayState?.PositionTicks ?? 0
    return [{
      key: `playback:${s.Id}:${item.Id}`,
      title: episode ?? item.Name,
      device: s.DeviceName ?? "Jellyfin",
      paused: s.PlayState?.IsPaused === true,
      // Jellyfin ticks are 100 ns.
      remainingMs: runtime === undefined ? null : Math.max(0, (runtime - position) / 10_000),
      positionMs: position / 10_000,
      runtimeMs: runtime === undefined ? null : runtime / 10_000
    }]
  })

/**
 * Turns two successive snapshots of Jellyfin's sessions into playback events: new items started,
 * the ones still there moved on, the ones gone stopped.
 */
export const playbackEvents = (
  before: ReadonlyMap<string, Playing>,
  now: ReadonlyArray<Playing>,
  nowMs: number
): ReadonlyArray<FlowEvent> => {
  const events: Array<FlowEvent> = []
  const seen = new Set<string>()
  for (const p of now) {
    seen.add(p.key)
    const subject = { kind: "playback" as const, key: p.key, title: p.title, device: p.device }
    const values = p.paused
      ? {
        paused: true,
        detail: p.device,
        ...(p.runtimeMs === null || p.runtimeMs === 0 ? {} : { progress: p.positionMs / p.runtimeMs })
      }
      : {
        paused: false,
        detail: p.device,
        ...(p.remainingMs === null ? {} : { endsAt: nowMs + p.remainingMs, startsAt: nowMs - p.positionMs })
      }
    events.push({ type: before.has(p.key) ? "playback.progress" : "playback.started", subject, values })
  }
  for (const [key, p] of before) {
    if (!seen.has(key)) {
      events.push({ type: "playback.stopped", subject: { kind: "playback", key, title: p.title, device: p.device } })
    }
  }
  return events
}

/** The Jellyfin session a playback subject belongs to (`playback:<session>:<item>`). */
export const sessionOf = (subjectKey: string): string | null => {
  const [kind, session] = subjectKey.split(":")
  return kind === "playback" && session !== undefined && session !== "" ? session : null
}

/** Jellyfin's provider id keys are capitalized ("Tmdb", "Tvdb"), but be lenient. */
const providerId = (item: typeof Item.Type, provider: string) =>
  Object.entries(item.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === provider)?.[1]

/**
 * The item of this title among Jellyfin's, by any id both know: TMDB or IMDb for a movie, TVDB,
 * TMDB or IMDb for a series. Never its name.
 */
export const matchItem = (result: typeof ItemsResult.Type, lookup: MediaLookup): string | null => {
  const ids = lookupIds(lookup)
  return result.Items.find((item) => ids.some(([provider, id]) => providerId(item, provider) === id))?.Id ?? null
}

/** Whether every episode of the lookup has a file (Jellyfin also lists missing ones, as virtual). */
export const hasEpisodes = (result: typeof EpisodesResult.Type, lookup: Extract<MediaLookup, { readonly _tag: "Episodes" }>) => {
  const present = new Set(result.Items.filter((e) => e.LocationType !== "Virtual").map((e) => `${e.ParentIndexNumber}:${e.IndexNumber}`))
  return lookup.episodes.every((e) => present.has(`${e.season}:${e.episode}`))
}

export const watchIds = {
  sessions: "jellyfin:sessions",
  users: "jellyfin:users",
  find: (subjectKey: string) => `jellyfin:find:${subjectKey}`,
  episodes: (subjectKey: string) => `jellyfin:episodes:${subjectKey}`
}

/** Running activities waiting for "Available in Jellyfin", with a lookup to search it by. */
const awaitingAvailability = (context: WatchContext): ReadonlyArray<Activity> =>
  runningWhere(context, (a, flow) => {
    const target = flow.steps.findIndex((s) => s.on === "media.available")
    return a.lookup !== null && target > a.stepIndex
  })

/**
 * The titles Jellyfin got last, newest first, with their ids: a title just imported is among them.
 * Matched on its TMDB or TVDB id, never its name (Sonarr's "Our House (2022)" is Jellyfin's "Our
 * House", and a library in another language names it otherwise). Jellyfin can't filter on an id's
 * value, and a series' date is that of its last episode added.
 */
export const latestItemsParams = (lookup: MediaLookup, userId: string | null): Record<string, string> => ({
  ...(userId === null ? {} : { userId }),
  Recursive: "true",
  IncludeItemTypes: lookup._tag === "Movie" ? "Movie" : "Series",
  SortBy: lookup._tag === "Movie" ? "DateCreated" : "DateLastContentAdded",
  SortOrder: "Descending",
  Limit: "100",
  Fields: "ProviderIds"
})

const query = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`

/**
 * Jellyfin doesn't push to Quai: Quai Home reads, every 15 s, whether imported titles are available
 * (while some activity awaits it) and what plays (while a playback flow is on). A series is found
 * in two reads: the series among the latest by its TVDB id, then its episodes. Its remote control runs the playback
 * buttons, as one-off calls through Quai Home.
 */
export const jellyfin = Effect.gen(function*() {
  const reads = yield* HomeReads
  // What played at the last snapshot, to tell started, moved and stopped apart.
  let playing = new Map<string, Playing>()
  // Series found, by subject: their episodes are read next.
  const series = new Map<string, string>()
  // Whose library is listed, once Jellyfin's users are read.
  let userId: string | null = null

  const command = (name: PlaybackCommand): ActionHandler => (activity) => {
    const session = sessionOf(activity.subjectKey)
    if (session === null) return Effect.fail(new InvalidAction({ message: "Not a playback." }))
    return actionCall(reads, "Jellyfin", { service: "jellyfin", method: "POST", path: `/Sessions/${encodeURIComponent(session)}/Playing/${name}` })
  }

  const actions: Partial<Record<ActionType, ActionHandler>> = {
    "playback.playPause": command("PlayPause"),
    "playback.stop": command("Stop")
  }

  const available = (activity: Activity): ReadonlyArray<FlowEvent> => [{
    type: "media.available",
    subject: {
      kind: "media",
      key: activity.subjectKey,
      title: activity.title,
      mediaType: activity.lookup!._tag === "Movie" ? "movie" : "series"
    }
  }]

  const integration: Integration = {
    service: "jellyfin",
    watcher: {
      watches: (context) => {
        const awaiting = awaitingAvailability(context)
        const keys = new Set(awaiting.map((a) => a.subjectKey))
        for (const key of series.keys()) if (!keys.has(key)) series.delete(key)
        const seen = new Set<string>()
        // The users, to list the library as one of them (`libraryUser`). Until they're read (or
        // with a Quai Home too old to read them), the library is listed without a user.
        const users = awaiting.length === 0 ? [] : [{ id: watchIds.users, service: "jellyfin" as const, path: "/Users", everySeconds: 3600 }]
        const user = userId
        const watches = [...users, ...awaiting.flatMap((activity) => {
          if (seen.has(activity.subjectKey)) return []
          seen.add(activity.subjectKey)
          const lookup = activity.lookup!
          const found = series.get(activity.subjectKey)
          if (lookup._tag === "Episodes" && found !== undefined) {
            return [{
              id: watchIds.episodes(activity.subjectKey),
              service: "jellyfin" as const,
              path: query("/Items", { ...(user === null ? {} : { userId: user }), ParentId: found, IncludeItemTypes: "Episode", Recursive: "true", Fields: "LocationType" }),
              everySeconds: 15
            }]
          }
          return [{
            id: watchIds.find(activity.subjectKey),
            service: "jellyfin" as const,
            path: query("/Items", latestItemsParams(lookup, user)),
            everySeconds: 15
          }]
        })]
        if (anyEnabledFlow(context, "playback")) {
          watches.push({ id: watchIds.sessions, service: "jellyfin", path: query("/Sessions", { ActiveWithinSeconds: "120" }), everySeconds: 15 })
        } else {
          playing = new Map()
        }
        return watches
      },
      read: ({ watch, status, body }, context) =>
        Effect.gen(function*() {
          if (status !== 200) return yield* Effect.as(Effect.logWarning(`Jellyfin answered HTTP ${status}`), [])
          if (watch.id === watchIds.sessions) {
            const sessions = readJson(Sessions, body)
            if (Option.isNone(sessions)) return yield* Effect.as(Effect.logWarning("Jellyfin: could not read the sessions"), [])
            const now = playingFrom(sessions.value)
            const events = playbackEvents(playing, now, yield* Clock.currentTimeMillis)
            playing = new Map(now.map((p) => [p.key, p]))
            return events
          }
          if (watch.id === watchIds.users) {
            const users = readJson(Users, body)
            if (Option.isNone(users)) return yield* Effect.as(Effect.logWarning("Jellyfin: could not read the users"), [])
            userId = libraryUser(users.value)
            if (userId === null) yield* Effect.logWarning("Jellyfin: no enabled user to list the library as")
            return []
          }
          const activity = awaitingAvailability(context).find((a) =>
            watch.id === watchIds.find(a.subjectKey) || watch.id === watchIds.episodes(a.subjectKey))
          if (activity === undefined) return []
          const lookup = activity.lookup!
          if (watch.id === watchIds.episodes(activity.subjectKey)) {
            const episodes = readJson(EpisodesResult, body)
            return lookup._tag === "Episodes" && Option.isSome(episodes) && hasEpisodes(episodes.value, lookup) ? available(activity) : []
          }
          const items = readJson(ItemsResult, body)
          if (Option.isNone(items)) return yield* Effect.as(Effect.logWarning("Jellyfin: could not read the search"), [])
          const id = matchItem(items.value, lookup)
          if (id === null) return []
          if (lookup._tag === "Movie") return available(activity)
          // The series is there: its episodes are watched next (the Hub syncs after each read).
          series.set(activity.subjectKey, id)
          return []
        })
    },
    actions
  }
  return integration
})
