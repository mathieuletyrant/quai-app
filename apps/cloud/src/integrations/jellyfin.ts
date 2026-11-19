import { type ActionType, InvalidAction } from "@quai/api"
import { Clock, Effect, Option, Schema } from "effect"
import type { Activity } from "../flows/Engine.ts"
import type { FlowEvent, MediaLookup } from "../flows/Events.ts"
import { HomeLink } from "../home/HomeLink.ts"
import { type ActionHandler, anyEnabledFlow, type Integration, readJson, runningWhere, type WatchContext } from "./Integration.ts"

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

/** The item of this title in a search result, by its TMDB (movie) or TVDB (series) id. */
export const matchItem = (result: typeof ItemsResult.Type, lookup: MediaLookup): string | null =>
  lookup._tag === "Movie"
    ? result.Items.find((i) => providerId(i, "tmdb") === String(lookup.tmdbId))?.Id ?? null
    : result.Items.find((i) => providerId(i, "tvdb") === String(lookup.tvdbId))?.Id ?? null

/** Whether every episode of the lookup has a file (Jellyfin also lists missing ones, as virtual). */
export const hasEpisodes = (result: typeof EpisodesResult.Type, lookup: Extract<MediaLookup, { readonly _tag: "Episodes" }>) => {
  const present = new Set(result.Items.filter((e) => e.LocationType !== "Virtual").map((e) => `${e.ParentIndexNumber}:${e.IndexNumber}`))
  return lookup.episodes.every((e) => present.has(`${e.season}:${e.episode}`))
}

export const watchIds = {
  sessions: "jellyfin:sessions",
  find: (subjectKey: string) => `jellyfin:find:${subjectKey}`,
  episodes: (subjectKey: string) => `jellyfin:episodes:${subjectKey}`
}

/** Running activities waiting for "Available in Jellyfin", with a lookup to search it by. */
const awaitingAvailability = (context: WatchContext): ReadonlyArray<Activity> =>
  runningWhere(context, (a, flow) => {
    const target = flow.steps.findIndex((s) => s.on === "media.available")
    return a.lookup !== null && target > a.stepIndex
  })

const query = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`

/**
 * Jellyfin doesn't push to Quai: Quai Home reads, every 15 s, whether imported titles are available
 * (while some activity awaits it) and what plays (while a playback flow is on). A series is found
 * in two reads: the series by its TVDB id, then its episodes. Its remote control runs the playback
 * buttons, as one-off calls through Quai Home.
 */
export const jellyfin = Effect.gen(function*() {
  const link = yield* HomeLink
  // What played at the last snapshot, to tell started, moved and stopped apart.
  let playing = new Map<string, Playing>()
  // Series found, by subject: their episodes are read next.
  const series = new Map<string, string>()

  const command = (name: PlaybackCommand): ActionHandler => (activity) => {
    const session = sessionOf(activity.subjectKey)
    if (session === null) return Effect.fail(new InvalidAction({ message: "Not a playback." }))
    return link.call({ service: "jellyfin", method: "POST", path: `/Sessions/${encodeURIComponent(session)}/Playing/${name}` }).pipe(
      Effect.mapError((e) => new InvalidAction({ message: `Jellyfin: ${e.message}` })),
      Effect.flatMap((r) => r.status < 300 ? Effect.void : Effect.fail(new InvalidAction({ message: `Jellyfin: HTTP ${r.status}` })))
    )
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
        const watches = awaiting.flatMap((activity) => {
          if (seen.has(activity.subjectKey)) return []
          seen.add(activity.subjectKey)
          const lookup = activity.lookup!
          const found = series.get(activity.subjectKey)
          if (lookup._tag === "Episodes" && found !== undefined) {
            return [{
              id: watchIds.episodes(activity.subjectKey),
              service: "jellyfin" as const,
              path: query("/Items", { ParentId: found, IncludeItemTypes: "Episode", Recursive: "true", Fields: "LocationType" }),
              everySeconds: 15
            }]
          }
          return [{
            id: watchIds.find(activity.subjectKey),
            service: "jellyfin" as const,
            path: query("/Items", {
              Recursive: "true",
              IncludeItemTypes: lookup._tag === "Movie" ? "Movie" : "Series",
              SearchTerm: lookup.title,
              Fields: "ProviderIds"
            }),
            everySeconds: 15
          }]
        })
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
