import type { ActionType, CatalogAction, CatalogEvent, Flow, FlowStep, StepShow } from "@quai/api"

/** A flow being edited: the contract's type, writable. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Array<Mutable<U>> : T[K] extends object ? Mutable<T[K]> : T[K] }
export type Draft = Mutable<Flow>
export type DraftStep = Draft["steps"][number]
export type EventType = FlowStep["on"]

export const clone = (flow: Flow | Draft): Draft => structuredClone(flow) as Draft

export const sameFlow = (a: Flow | Draft, b: Flow | Draft) => JSON.stringify(a) === JSON.stringify(b)

export const slug = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "flow"

export const palette = ["#FFC230", "#FF8A3D", "#FF6B5B", "#B57EDC", "#8B8CF8", "#4FC3F7", "#6FD3C2", "#30D158"]

export const subjects: Record<Flow["subject"], { readonly label: string; readonly description: string; readonly icon: string }> = {
  media: { label: "Downloads", description: "A title from Radarr or Sonarr to Jellyfin.", icon: "arrow.down" },
  playback: { label: "Playback", description: "What plays on Jellyfin, with remote buttons.", icon: "play.fill" },
  service: { label: "Server health", description: "A service that stops answering.", icon: "server.rack" },
  request: { label: "Requests", description: "A Seerr request waiting for approval, with Approve and Decline.", icon: "person.fill.questionmark" }
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

/** An event's label without the services in brackets, which the console shows as badges. */
export const eventName = (event: CatalogEvent) => event.label.replace(/ \(.*\)$/, "")

export const showLabels: Record<keyof StepShow, string> = {
  progress: "Progress",
  speed: "Speed",
  eta: "Time left",
  timer: "Countdown to end",
  since: "Time since"
}

/** The catalog, as the editor reads it: step events and buttons for one kind of flow. */
export interface Catalogs {
  readonly events: ReadonlyArray<CatalogEvent>
  readonly actions: ReadonlyArray<CatalogAction>
}

export const stepEvents = (catalogs: Catalogs, subject: Flow["subject"]) =>
  catalogs.events.filter((e) => !e.data && e.subject === subject)

export const stepActions = (catalogs: Catalogs, subject: Flow["subject"]) =>
  catalogs.actions.filter((a) => a.subject === subject)

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
  const unused = events.find((e) => !flow.steps.some((s) => s.on === e.type)) ?? events[0]!
  let n = flow.steps.length + 1
  while (flow.steps.some((s) => s.id === `step-${n}`)) n++
  return { id: `step-${n}`, label: unused.label.replace(/ \(.*\)$/, ""), icon: "sparkles", on: unused.type, show: {} }
}
