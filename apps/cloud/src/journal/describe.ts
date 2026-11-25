import {
  type IntegrationSource,
  isDataEvent,
  type JournalNote,
  type JournalSource,
  journalSourceNames
} from "@quai/api"
import type { FlowEvent, Subject } from "../flows/Events.ts"

/** The journal's source for an integration's service: Quai's own checks are the Cloud's. */
export type From = IntegrationSource

export const sourceOf = (service: From): JournalSource => service === "quai" ? "cloud" : service

/** What a line about an event is made of: the service's name, the title, its subject and detail. */
interface Said {
  readonly name: string
  readonly title: string
  readonly subject: Subject
  readonly detail: string | undefined
}

const onDevice = (subject: Subject) => subject.kind === "playback" ? ` on ${subject.device}` : ""

/** The line for each step event the journal tells. */
const lines: Partial<Record<FlowEvent["type"], (said: Said) => string>> = {
  "media.added": ({ name, title }) => `${title} added to ${name}`,
  "media.grabbed": ({ name, title }) => `${name} grabbed a release of ${title}`,
  "media.imported": ({ name, title }) => `${name} imported ${title}`,
  "media.importBlocked": ({ name, title }) => `${name} can't import ${title} on its own: it's in To fix`,
  "download.removed": ({ title }) => `${title}: the download is gone before its import`,
  "media.available": ({ name, title }) => `${title} is available in ${name}`,
  "playback.started": ({ subject, title }) => `${title} started playing${onDevice(subject)}`,
  "playback.stopped": ({ subject, title }) => `${title} stopped${onDevice(subject)}`,
  "request.pending": ({ subject, title }) =>
    `${subject.kind === "request" ? subject.requester : "Someone"} asked for ${title}: waiting for approval`,
  "request.approved": ({ title }) => `The request for ${title} was approved`,
  "request.declined": ({ detail, title }) =>
    `The request for ${title} was ${detail === "Removed" ? "removed" : "declined"}`,
  "releases.today": ({ detail }) => `Tonight's releases begin${detail === undefined ? "" : `: ${detail}`}`,
  "releases.available": () => "Every release of tonight is here",
  "releases.dayOver": () => "Midnight: the day's releases are over"
}

/** A title's line links to it when its subject is one the app can open. */
const aboutOf = (subject: Subject) =>
  subject.kind === "media" || subject.kind === "request" || subject.kind === "playback"
    ? { subject: subject.key, title: subject.title }
    : {}

/**
 * What an event from a service means, in one plain line; null for the data events (a download's
 * progress, a playback's position), which change only numbers.
 */
export const eventNote = (event: FlowEvent, from: From): JournalNote | null => {
  const subject = event.subject
  if (isDataEvent(event.type) || subject === undefined) return null
  const line = lines[event.type]
  if (line === undefined) return null
  const source = sourceOf(from)
  const text = line({ name: journalSourceNames[source], title: subject.title, subject, detail: event.values?.detail })
  return {
    level: "info",
    source,
    kind: event.type,
    text,
    ...aboutOf(subject),
    ...(event.flowId === undefined ? {} : { flowId: event.flowId })
  }
}
