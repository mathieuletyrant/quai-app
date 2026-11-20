import { Schema } from "effect"

/** What one activity follows. */
export const FlowSubject = Schema.Literals(["media", "playback", "service", "request", "day"]).annotate({ identifier: "FlowSubject" })
export type FlowSubject = typeof FlowSubject.Type

/** The normalized events flows are built from (docs/flows.md, Event catalog). */
export const EventType = Schema.Literals([
  "media.added",
  "media.grabbed",
  "media.imported",
  "media.available",
  "download.progress",
  "playback.started",
  "playback.progress",
  "playback.stopped",
  "service.down",
  "service.up",
  "request.pending",
  "request.approved",
  "request.declined",
  "releases.today",
  "releases.progress",
  "releases.available",
  "releases.dayOver"
]).annotate({ identifier: "EventType" })
export type EventType = typeof EventType.Type

/** Where events come from and where actions go: one integration per service on the server. */
export const ServiceName = Schema.Literals(["radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "quai"]).annotate({ identifier: "ServiceName" })
export type ServiceName = typeof ServiceName.Type

/** Buttons a step can offer on the Live Activity (docs/flows.md, Actions). */
export const ActionType = Schema.Literals(["playback.playPause", "playback.stop", "request.approve", "request.decline"]).annotate({ identifier: "ActionType" })
export type ActionType = typeof ActionType.Type

/** Live values a step can display. */
export const StepShow = Schema.Struct({
  progress: Schema.optionalKey(Schema.Boolean),
  speed: Schema.optionalKey(Schema.Boolean),
  eta: Schema.optionalKey(Schema.Boolean),
  timer: Schema.optionalKey(Schema.Boolean),
  since: Schema.optionalKey(Schema.Boolean),
  /** A short list of items, each with its state (the day's releases). */
  list: Schema.optionalKey(Schema.Boolean)
}).annotate({ identifier: "StepShow" })
export type StepShow = typeof StepShow.Type

const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/))
const Hex = Schema.String.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/))
const Symbol = Schema.String.check(Schema.isPattern(/^[a-z0-9.]{1,60}$/))

export const FlowStep = Schema.Struct({
  id: Slug,
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(24)),
  icon: Symbol,
  on: EventType,
  show: StepShow,
  actions: Schema.optionalKey(Schema.Array(ActionType))
}).annotate({ identifier: "FlowStep" })
export type FlowStep = typeof FlowStep.Type

export const FlowFilter = Schema.Struct({
  /** media and request flows: which titles. */
  mediaType: Schema.optionalKey(Schema.Literals(["any", "movie", "series"])),
  /** playback flows: Jellyfin device names; empty or absent: every device. */
  devices: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * day flows: the local time ("18:00", the home's time zone) the activity starts at, or earlier
   * when the day's first release airs before. Absent: 18:00.
   */
  startsAt: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)))
}).annotate({ identifier: "FlowFilter" })
export type FlowFilter = typeof FlowFilter.Type

export const Flow = Schema.Struct({
  id: Slug,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  builtIn: Schema.Boolean,
  enabled: Schema.Boolean,
  color: Hex,
  icon: Symbol,
  subject: FlowSubject,
  filter: FlowFilter,
  steps: Schema.Array(FlowStep).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
  /**
   * An event that ends the activity where it is, without being a step (playback stopped, a request
   * declined). Reaching the last step ends the activity too, except in a one-step flow with an end
   * event: it runs until that event (or expiry).
   */
  endOn: Schema.optionalKey(EventType),
  lingerMinutes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60 })),
  stalledAfterMinutes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 }))),
  expireAfterMinutes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 })))
}).annotate({ identifier: "Flow" })
export type Flow = typeof Flow.Type

/** One step as the iPhone draws it. */
export const ActivityStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  icon: Schema.String,
  actions: Schema.optionalKey(Schema.Array(ActionType))
}).annotate({ identifier: "ActivityStep" })

/** Fixed for the activity's life: pushed as APNs `attributes` on start. */
export const ActivityAttributes = Schema.Struct({
  key: Schema.String,
  flowId: Schema.String,
  title: Schema.String,
  color: Schema.String,
  icon: Schema.String,
  /** Only the steps this iPhone shows. */
  steps: Schema.Array(ActivityStep)
}).annotate({ identifier: "ActivityAttributes" })
export type ActivityAttributes = typeof ActivityAttributes.Type

export const ActivityTone = Schema.Literals(["active", "stalled", "done"]).annotate({ identifier: "ActivityTone" })

/** One line of a step showing a list: `waiting` (not there yet), `active` (on its way), `done`. */
export const ActivityItemState = Schema.Literals(["waiting", "active", "done"]).annotate({ identifier: "ActivityItemState" })

export const ActivityItem = Schema.Struct({
  /** Short: "Severance S02E03". */
  title: Schema.String,
  /** Epoch seconds it airs at, when known: the iPhone writes it in its own time. */
  at: Schema.optionalKey(Schema.Finite),
  state: ActivityItemState
}).annotate({ identifier: "ActivityItem" })
export type ActivityItem = typeof ActivityItem.Type

/**
 * What the activity shows now: pushed as APNs `content-state`. Values are left out when the step
 * doesn't show them (Swift reads a missing key as nil; the generator drops `anyOf [X, null]`).
 */
export const ActivityContent = Schema.Struct({
  /** Index into `attributes.steps`. */
  step: Schema.Int,
  tone: ActivityTone,
  progress: Schema.optionalKey(Schema.Finite),
  bytesPerSecond: Schema.optionalKey(Schema.Finite),
  remainingSeconds: Schema.optionalKey(Schema.Finite),
  /** Epoch seconds the countdown runs to (playback end). */
  endsAt: Schema.optionalKey(Schema.Finite),
  /** Epoch seconds the timeline began: with `endsAt`, the iPhone animates the bar on its own. */
  startsAt: Schema.optionalKey(Schema.Finite),
  /** Playback paused: the bar holds at `progress` and the button shows Play. */
  paused: Schema.optionalKey(Schema.Boolean),
  /** Epoch seconds the step began (time since an incident). */
  since: Schema.optionalKey(Schema.Finite),
  detail: Schema.optionalKey(Schema.String),
  /** At most 4 lines (the day's releases): the push stays well under APNs' 4 KB. */
  items: Schema.optionalKey(Schema.Array(ActivityItem))
}).annotate({ identifier: "ActivityContent" })
export type ActivityContent = typeof ActivityContent.Type

/** An action entry, for the console's step editor. */
export const CatalogAction = Schema.Struct({
  type: ActionType,
  subject: FlowSubject,
  label: Schema.String,
  service: ServiceName
}).annotate({ identifier: "CatalogAction" })
export type CatalogAction = typeof CatalogAction.Type

/** A catalog entry, for the console's step picker. */
export const CatalogEvent = Schema.Struct({
  type: EventType,
  subject: FlowSubject,
  label: Schema.String,
  /** Data events update the current step; they can't enter a step. */
  data: Schema.Boolean,
  /** The services that produce it. */
  services: Schema.Array(ServiceName)
}).annotate({ identifier: "CatalogEvent" })
export type CatalogEvent = typeof CatalogEvent.Type
