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
  {
    type: "media.grabbed",
    subject: "media",
    label: "Release grabbed (Radarr, Sonarr)",
    data: false,
    services: ["radarr", "sonarr"]
  },
  {
    type: "media.imported",
    subject: "media",
    label: "Imported (Radarr, Sonarr)",
    data: false,
    services: ["radarr", "sonarr"]
  },
  {
    type: "media.importBlocked",
    subject: "media",
    label: "Import needs you (Radarr, Sonarr)",
    data: true,
    services: ["radarr", "sonarr"]
  },
  { type: "media.available", subject: "media", label: "Available in Jellyfin", data: false, services: ["jellyfin"] },
  {
    type: "download.progress",
    subject: "media",
    label: "Download progress (qBittorrent)",
    data: true,
    services: ["qbittorrent"]
  },
  {
    type: "download.removed",
    subject: "media",
    label: "Download gone before its import (qBittorrent)",
    data: true,
    services: ["qbittorrent"]
  },
  {
    type: "playback.started",
    subject: "playback",
    label: "Playback started (Jellyfin)",
    data: false,
    services: ["jellyfin"]
  },
  {
    type: "playback.progress",
    subject: "playback",
    label: "Playback position (Jellyfin)",
    data: true,
    services: ["jellyfin"]
  },
  {
    type: "playback.stopped",
    subject: "playback",
    label: "Playback stopped (Jellyfin)",
    data: false,
    services: ["jellyfin"]
  },
  {
    type: "request.pending",
    subject: "request",
    label: "Request waiting for approval (Seerr)",
    data: false,
    services: ["seerr"]
  },
  { type: "request.approved", subject: "request", label: "Request approved (Seerr)", data: false, services: ["seerr"] },
  { type: "request.declined", subject: "request", label: "Request declined (Seerr)", data: false, services: ["seerr"] },
  {
    type: "releases.today",
    subject: "day",
    label: "Today's releases begin (Radarr, Sonarr)",
    data: false,
    services: ["radarr", "sonarr"]
  },
  {
    type: "releases.progress",
    subject: "day",
    label: "A release grabbed or available (Radarr, Sonarr)",
    data: true,
    services: ["radarr", "sonarr"]
  },
  {
    type: "releases.available",
    subject: "day",
    label: "Every release available (Radarr, Sonarr)",
    data: false,
    services: ["radarr", "sonarr"]
  },
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

export const actionSubject = (type: ActionType): FlowSubject =>
  actionCatalog.find((action) => action.type === type)!.subject

export const subjectOf = (type: EventType): FlowSubject => catalog.find((event) => event.type === type)!.subject
export const isDataEvent = (type: EventType): boolean => catalog.find((event) => event.type === type)!.data

/** What a step can show for each kind of flow: the values its data events carry. */
export const stepShows: Record<FlowSubject, ReadonlyArray<keyof StepShow>> = {
  media: ["progress", "speed", "eta"],
  // The countdown draws the bar too (held where it is while paused).
  playback: ["timer"],
  request: [],
  day: ["list"]
}

const sameIdProblem = (flow: Flow) =>
  new Set(flow.steps.map((step) => step.id)).size !== flow.steps.length ? "Two steps have the same id." : null

/** A step starts on an event that starts a step of this kind of flow. */
const stepEventProblem = (flow: Flow) => {
  for (const step of flow.steps) {
    if (isDataEvent(step.on)) return `“${step.label}” uses a data event: pick an event that starts a step.`
    if (subjectOf(step.on) !== flow.subject) return `“${step.label}” uses an event for another kind of flow.`
  }
  return null
}

const buttonProblem = (flow: Flow) => {
  const step = flow.steps.find((candidate) =>
    (candidate.actions ?? []).some((action) => actionSubject(action) !== flow.subject)
  )
  return step === undefined ? null : `“${step.label}” has a button for another kind of flow.`
}

// A request waits as long as it waits: an expiry would forget it and start it again at the next poll.
const requestExpiryProblem = (flow: Flow) =>
  flow.subject === "request" && flow.expireAfterMinutes !== undefined
    ? "A request flow ends when the request is approved, declined or deleted, not after no news."
    : null

const sameEventProblem = (flow: Flow) =>
  new Set(flow.steps.map((step) => step.on)).size !== flow.steps.length ? "Two steps start on the same event." : null

/** A flow ends on an event of its kind that no step starts on, or, with one step, after no news. */
const endProblem = (flow: Flow) => {
  if (flow.endOn === undefined) {
    return flow.steps.length < 2 && flow.expireAfterMinutes === undefined
      ? "A one-step flow needs an end event or an end after no news."
      : null
  }
  if (isDataEvent(flow.endOn) || subjectOf(flow.endOn) !== flow.subject) return "The end event doesn't fit this flow."
  return flow.steps.some((step) => step.on === flow.endOn) ? "The end event is also a step's event." : null
}

/**
 * The rules the schema alone can't check (docs/flows.md, Model), or null when the flow is valid.
 * The server refuses a flow that breaks one; the console shows it before saving. The first broken
 * rule is the one told.
 */
export const flowProblem = (flow: Flow): string | null =>
  sameIdProblem(flow) ?? stepEventProblem(flow) ?? buttonProblem(flow) ?? requestExpiryProblem(flow) ??
    sameEventProblem(flow) ?? endProblem(flow)

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
      {
        id: "downloading",
        label: "Downloading",
        icon: "arrow.down",
        on: "media.grabbed",
        show: { progress: true, speed: true, eta: true }
      },
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
    id: "today",
    name: "Today's releases",
    builtIn: true,
    enabled: true,
    color: "#4FC3F7",
    icon: "calendar",
    subject: "day",
    filter: { startsAt: defaultStartsAt },
    steps: [
      { id: "today", label: "Today", icon: "calendar", on: "releases.today", show: { list: true } },
      { id: "all-here", label: "All here", icon: "checkmark", on: "releases.available", show: { list: true } }
    ],
    endOn: "releases.dayOver",
    lingerMinutes: 15
  }
]
