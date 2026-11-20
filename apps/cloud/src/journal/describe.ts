import { type HomeProtocol, isDataEvent, type JournalNote, type JournalSource, journalSourceNames, type ServiceName } from "@quai/api"
import type { FlowEvent } from "../flows/Events.ts"

/** The journal's source for an integration's service: Quai's own checks are the Cloud's. */
export type From = ServiceName | HomeProtocol.HomeService

export const sourceOf = (service: From): JournalSource => service === "quai" ? "cloud" : service

/**
 * What an event from a service means, in one plain line; null for the data events (a download's
 * progress, a playback's position), which change only numbers.
 */
export const eventNote = (event: FlowEvent, from: From): JournalNote | null => {
  const subject = event.subject
  if (isDataEvent(event.type) || subject === undefined) return null
  const source = sourceOf(from)
  const name = journalSourceNames[source]
  const title = subject.title
  const about = subject.kind === "media" || subject.kind === "request" || subject.kind === "playback"
    ? { subject: subject.key, title }
    : {}
  const note = (text: string, level: JournalNote["level"] = "info"): JournalNote => ({
    level,
    source,
    kind: event.type,
    text,
    ...about,
    ...(event.flowId === undefined ? {} : { flowId: event.flowId })
  })
  const detail = event.values?.detail
  switch (event.type) {
    case "media.added":
      return note(`${title} added to ${name}`)
    case "media.grabbed":
      return note(`${name} grabbed a release of ${title}`)
    case "media.imported":
      return note(`${name} imported ${title}`)
    case "media.available":
      return note(`${title} is available in ${name}`)
    case "playback.started":
      return note(`${title} started playing${subject.kind === "playback" ? ` on ${subject.device}` : ""}`)
    case "playback.stopped":
      return note(`${title} stopped${subject.kind === "playback" ? ` on ${subject.device}` : ""}`)
    case "request.pending":
      return note(`${subject.kind === "request" ? subject.requester : "Someone"} asked for ${title}: waiting for approval`)
    case "request.approved":
      return note(`The request for ${title} was approved`)
    case "request.declined":
      return note(`The request for ${title} was ${detail === "Removed" ? "removed" : "declined"}`)
    case "releases.today":
      return note(`Tonight's releases begin${detail === undefined ? "" : `: ${detail}`}`)
    case "releases.available":
      return note("Every release of tonight is here")
    case "releases.dayOver":
      return note("Midnight: the day's releases are over")
    default:
      return null
  }
}
