import type { ActionType, EventType, Flow, FlowSubject, ServiceName, StepShow } from "./Activity.ts"

/**
 * Every event a flow can use, with its subject, the services that produce it, and how the console
 * names it. On the server, each service's integration (apps/cloud/src/integrations) emits them.
 */
export const catalog: ReadonlyArray<{
  readonly type: EventType
  readonly subject: FlowSubject
  readonly label: string
  readonly data: boolean
  readonly services: ReadonlyArray<ServiceName>
}> = [
  { type: "media.added", subject: "media", label: "Added (Radarr)", data: false, services: ["radarr"] },
  { type: "media.grabbed", subject: "media", label: "Release grabbed (Radarr, Sonarr)", data: false, services: ["radarr", "sonarr"] },
  { type: "media.imported", subject: "media", label: "Imported (Radarr, Sonarr)", data: false, services: ["radarr", "sonarr"] },
  { type: "media.available", subject: "media", label: "Available in Jellyfin", data: false, services: ["jellyfin"] },
  { type: "download.progress", subject: "media", label: "Download progress (qBittorrent)", data: true, services: ["qbittorrent"] },
  { type: "playback.started", subject: "playback", label: "Playback started (Jellyfin)", data: false, services: ["jellyfin"] },
  { type: "playback.progress", subject: "playback", label: "Playback position (Jellyfin)", data: true, services: ["jellyfin"] },
  { type: "playback.stopped", subject: "playback", label: "Playback stopped (Jellyfin)", data: false, services: ["jellyfin"] },
  { type: "service.down", subject: "service", label: "Service down for 5 min", data: false, services: ["quai"] },
  { type: "service.up", subject: "service", label: "Service back", data: false, services: ["quai"] },
  { type: "request.pending", subject: "request", label: "Request waiting for approval (Seerr)", data: false, services: ["seerr"] },
  { type: "request.approved", subject: "request", label: "Request approved (Seerr)", data: false, services: ["seerr"] },
  { type: "request.declined", subject: "request", label: "Request declined (Seerr)", data: false, services: ["seerr"] },
  { type: "releases.today", subject: "day", label: "Today's releases begin (Radarr, Sonarr)", data: false, services: ["radarr", "sonarr"] },
  { type: "releases.progress", subject: "day", label: "A release grabbed or available (Radarr, Sonarr)", data: true, services: ["radarr", "sonarr"] },
  { type: "releases.available", subject: "day", label: "Every release available (Radarr, Sonarr)", data: false, services: ["radarr", "sonarr"] },
  { type: "releases.dayOver", subject: "day", label: "Midnight", data: false, services: ["quai"] }
]

/** Every button a step can offer. */
export const actionCatalog: ReadonlyArray<{
  readonly type: ActionType
  readonly subject: FlowSubject
  readonly label: string
  readonly service: ServiceName
}> = [
  { type: "playback.playPause", subject: "playback", label: "Play / Pause", service: "jellyfin" },
  { type: "playback.stop", subject: "playback", label: "Stop", service: "jellyfin" },
  { type: "request.approve", subject: "request", label: "Approve", service: "seerr" },
  { type: "request.decline", subject: "request", label: "Decline", service: "seerr" }
]

export const actionSubject = (type: ActionType): FlowSubject => actionCatalog.find((a) => a.type === type)!.subject

export const subjectOf = (type: EventType): FlowSubject => catalog.find((e) => e.type === type)!.subject
export const isDataEvent = (type: EventType): boolean => catalog.find((e) => e.type === type)!.data

/** What a step can show for each kind of flow: the values its data events carry. */
export const stepShows: Record<FlowSubject, ReadonlyArray<keyof StepShow>> = {
  media: ["progress", "speed", "eta"],
  // The countdown draws the bar too (held where it is while paused).
  playback: ["timer"],
  service: ["since"],
  request: [],
  day: ["list"]
}

/**
 * The rules the schema alone can't check (docs/flows.md, Model), or null when the flow is valid.
 * The server refuses a flow that breaks one; the console shows it before saving.
 */
export const flowProblem = (flow: Flow): string | null => {
  const ids = new Set(flow.steps.map((s) => s.id))
  if (ids.size !== flow.steps.length) return "Two steps have the same id."
  for (const step of flow.steps) {
    if (isDataEvent(step.on)) return `“${step.label}” uses a data event: pick an event that starts a step.`
    if (subjectOf(step.on) !== flow.subject) return `“${step.label}” uses an event for another kind of flow.`
  }
  for (const step of flow.steps) {
    for (const action of step.actions ?? []) {
      if (actionSubject(action) !== flow.subject) return `“${step.label}” has a button for another kind of flow.`
    }
  }
  // A request waits as long as it waits: an expiry would forget it and start it again at the next poll.
  if (flow.subject === "request" && flow.expireAfterMinutes !== undefined) {
    return "A request flow ends when the request is approved, declined or deleted, not after no news."
  }
  const events = new Set(flow.steps.map((s) => s.on))
  if (events.size !== flow.steps.length) return "Two steps start on the same event."
  if (flow.endOn !== undefined) {
    if (isDataEvent(flow.endOn) || subjectOf(flow.endOn) !== flow.subject) return "The end event doesn't fit this flow."
    if (events.has(flow.endOn)) return "The end event is also a step's event."
  } else if (flow.steps.length < 2 && flow.expireAfterMinutes === undefined) {
    return "A one-step flow needs an end event or an end after no news."
  }
  return null
}

/** When a day flow starts, in the home's time zone, unless a release airs earlier. */
export const defaultStartsAt = "18:00"

/** The flows Quai ships with. Editable and resettable in the console; not deletable. */
export const builtInFlows: ReadonlyArray<Flow> = [
  {
    id: "download",
    name: "Download",
    builtIn: true,
    enabled: true,
    color: "#FFC230",
    icon: "arrow.down",
    subject: "media",
    filter: { mediaType: "any" },
    steps: [
      { id: "searching", label: "Searching", icon: "magnifyingglass", on: "media.added", show: {} },
      { id: "downloading", label: "Downloading", icon: "arrow.down", on: "media.grabbed", show: { progress: true, speed: true, eta: true } },
      { id: "importing", label: "Importing", icon: "tray.and.arrow.down.fill", on: "media.imported", show: {} },
      { id: "available", label: "Ready to watch", icon: "checkmark", on: "media.available", show: {} }
    ],
    lingerMinutes: 15,
    stalledAfterMinutes: 120
  },
  {
    id: "playback",
    name: "Jellyfin playback",
    builtIn: true,
    enabled: true,
    color: "#B57EDC",
    icon: "play.fill",
    subject: "playback",
    filter: { devices: [] },
    steps: [
      {
        id: "playing",
        label: "Playing",
        icon: "play.fill",
        on: "playback.started",
        show: { timer: true },
        actions: ["playback.playPause", "playback.stop"]
      }
    ],
    endOn: "playback.stopped",
    lingerMinutes: 0,
    expireAfterMinutes: 15
  },
  {
    id: "incident",
    name: "Server incident",
    builtIn: true,
    enabled: true,
    color: "#FF6B5B",
    icon: "exclamationmark.triangle.fill",
    subject: "service",
    filter: {},
    steps: [
      { id: "down", label: "Down", icon: "exclamationmark.triangle.fill", on: "service.down", show: { since: true } },
      { id: "back", label: "Back", icon: "checkmark", on: "service.up", show: {} }
    ],
    lingerMinutes: 5
  },
  {
    id: "request",
    name: "Requests",
    builtIn: true,
    enabled: true,
    color: "#8B8CF8",
    icon: "person.fill.questionmark",
    subject: "request",
    filter: { mediaType: "any" },
    steps: [
      {
        id: "pending",
        label: "To approve",
        icon: "person.fill.questionmark",
        on: "request.pending",
        show: {},
        actions: ["request.approve", "request.decline"]
      },
      { id: "approved", label: "Approved", icon: "checkmark", on: "request.approved", show: {} }
    ],
    endOn: "request.declined",
    lingerMinutes: 5
  },
  {
    id: "tonight",
    name: "Today's releases",
    builtIn: true,
    enabled: true,
    color: "#4FC3F7",
    icon: "calendar",
    subject: "day",
    filter: { startsAt: defaultStartsAt },
    steps: [
      { id: "tonight", label: "Today", icon: "calendar", on: "releases.today", show: { list: true } },
      { id: "all-here", label: "All here", icon: "checkmark", on: "releases.available", show: { list: true } }
    ],
    endOn: "releases.dayOver",
    lingerMinutes: 15
  }
]
