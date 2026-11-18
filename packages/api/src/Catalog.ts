import type { ActionType, EventType, Flow, FlowSubject } from "./Activity.ts"

/** Every event a flow can use, with its subject and how the console names it. */
export const catalog: ReadonlyArray<{
  readonly type: EventType
  readonly subject: FlowSubject
  readonly label: string
  readonly data: boolean
}> = [
  { type: "media.added", subject: "media", label: "Added (Radarr, Seerr)", data: false },
  { type: "media.grabbed", subject: "media", label: "Release grabbed (Radarr, Sonarr)", data: false },
  { type: "media.imported", subject: "media", label: "Imported (Radarr, Sonarr)", data: false },
  { type: "media.available", subject: "media", label: "Available in Jellyfin", data: false },
  { type: "download.progress", subject: "media", label: "Download progress (qBittorrent)", data: true },
  { type: "playback.started", subject: "playback", label: "Playback started (Jellyfin)", data: false },
  { type: "playback.progress", subject: "playback", label: "Playback position (Jellyfin)", data: true },
  { type: "playback.stopped", subject: "playback", label: "Playback stopped (Jellyfin)", data: false },
  { type: "service.down", subject: "service", label: "Service down for 5 min", data: false },
  { type: "service.up", subject: "service", label: "Service back", data: false }
]

/** Every button a step can offer. */
export const actionCatalog: ReadonlyArray<{
  readonly type: ActionType
  readonly subject: FlowSubject
  readonly label: string
}> = [
  { type: "playback.playPause", subject: "playback", label: "Play / Pause" },
  { type: "playback.stop", subject: "playback", label: "Stop" }
]

export const actionSubject = (type: ActionType): FlowSubject => actionCatalog.find((a) => a.type === type)!.subject

export const subjectOf = (type: EventType): FlowSubject => catalog.find((e) => e.type === type)!.subject
export const isDataEvent = (type: EventType): boolean => catalog.find((e) => e.type === type)!.data

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
  }
]
