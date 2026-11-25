import type { ActionType, CatalogAction, CatalogEvent, Flow, FlowStep, StepShow } from "@quai/api"

/** A flow being edited: the contract's type, writable. */
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Array<Mutable<U>>
    : T[K] extends object ? Mutable<T[K]>
    : T[K]
}
export type Draft = Mutable<Flow>
export type DraftStep = Draft["steps"][number]
export type EventType = FlowStep["on"]

export const clone = (flow: Flow | Draft): Draft => structuredClone(flow) as Draft

export const sameFlow = (left: Flow | Draft, right: Flow | Draft) => JSON.stringify(left) === JSON.stringify(right)

export const slug = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "flow"

/** The colours a flow can take: data saved with the flow and sent to the iPhone, so hex, not theme tokens. */
export const palette = ["#FFC230", "#FF8A3D", "#FF6B5B", "#B57EDC", "#8B8CF8", "#4FC3F7", "#6FD3C2", "#30D158"]

export const subjects: Record<
  Flow["subject"],
  { readonly label: string; readonly description: string; readonly icon: string }
> = {
  media: { label: "Downloads", description: "A title from Radarr or Sonarr to Jellyfin.", icon: "arrow.down" },
  playback: { label: "Playback", description: "What plays on Jellyfin, with remote buttons.", icon: "play.fill" },
  request: {
    label: "Requests",
    description: "A Seerr request waiting for approval, with Approve and Decline.",
    icon: "person.fill.questionmark"
  },
  day: {
    label: "Today's releases",
    description: "The day's episodes and movies from Sonarr and Radarr, from a time you pick.",
    icon: "calendar"
  }
}

/** How the console names each service an event comes from. */
export const serviceNames: Record<CatalogEvent["services"][number], string> = {
  radarr: "Radarr",
  sonarr: "Sonarr",
  qbittorrent: "qBittorrent",
  jellyfin: "Jellyfin",
  seerr: "Seerr",
  quai: "Quai health checks"
}

/** How a step's button looks on the Live Activity: Play while paused, Pause while playing. */
export const actionGlyph = (action: string, paused = false) =>
  action === "playback.stop"
    ? "stop.fill"
    : action === "request.approve"
    ? "checkmark"
    : action === "request.decline"
    ? "xmark"
    : paused
    ? "play.fill"
    : "pause.fill"

export const actionLabels: Record<ActionType, string> = {
  "playback.playPause": "Play / Pause",
  "playback.stop": "Stop",
  "request.approve": "Approve",
  "request.decline": "Decline"
}

/** Reaching the last step ends the activity, except in a one-step flow with an end event. */
export const endsAtLastStep = (flow: Draft) => flow.endOn === undefined || flow.steps.length > 1

/**
 * Whether the Live Activity draws its row of steps, as the iPhone decides it: not for one step,
 * nor for a flow with buttons (a request), whose buttons already say where it stands.
 */
export const showsSteps = (flow: Draft) =>
  flow.steps.length > 1 && !flow.steps.some((step) => (step.actions ?? []).length > 0)

/** An event's label without the services in brackets, which the console shows as badges. */
export const eventName = (event: CatalogEvent) => event.label.replace(/ \(.*\)$/, "")

/** "Release grabbed — Radarr, Sonarr": an event as a select lists it. */
export const eventOption = (event: CatalogEvent) =>
  `${eventName(event)} — ${event.services.map((service) => serviceNames[service]).join(", ")}`

export const showLabels: Record<keyof StepShow, string> = {
  progress: "Progress",
  speed: "Speed",
  eta: "Time left",
  timer: "Countdown to end",
  since: "Time since",
  list: "Releases, ticked off"
}

/** The catalog, as the editor reads it: step events and buttons for one kind of flow. */
export interface Catalogs {
  readonly events: ReadonlyArray<CatalogEvent>
  readonly actions: ReadonlyArray<CatalogAction>
}

export const stepEvents = (catalogs: Catalogs, subject: Flow["subject"]) =>
  catalogs.events.filter((event) => !event.data && event.subject === subject)

export const stepActions = (catalogs: Catalogs, subject: Flow["subject"]) =>
  catalogs.actions.filter((action) => action.subject === subject)

/**
 * Why a step will be skipped for some titles, if it will: series only follow a download once
 * Sonarr grabs it, so an event Sonarr doesn't send never happens for them.
 */
export const skippedFor = (flow: Draft, event: CatalogEvent | undefined): string | null => {
  if (flow.subject !== "media" || event === undefined || flow.filter.mediaType === "movie") return null
  if (event.services.includes("sonarr") || !event.services.includes("radarr")) return null
  return flow.filter.mediaType === "series"
    ? "Sonarr doesn't send this event: series never reach this step."
    : "Movies only: series start at the next step, once Sonarr grabs a release."
}

export const newStep = (flow: Draft, events: ReadonlyArray<CatalogEvent>): DraftStep => {
  const unused = events.find((event) => !flow.steps.some((step) => step.on === event.type)) ?? events[0]!
  let number = flow.steps.length + 1
  while (flow.steps.some((step) => step.id === `step-${number}`)) number++
  return {
    id: `step-${number}`,
    label: unused.label.replace(/ \(.*\)$/, ""),
    icon: "sparkles",
    on: unused.type,
    show: {}
  }
}
