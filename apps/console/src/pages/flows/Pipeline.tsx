import { type CatalogEvent, defaultStartsAt } from "@quai/api"
import type { CSSProperties, ReactNode } from "react"
import { shortMinutes } from "../../format.ts"
import { cx, Eyebrow, Icon } from "../../ui"
import { actionGlyph, actionLabels, type Draft, type DraftStep, endsAtLastStep, eventName, serviceNames, showLabels, skippedFor, subjects } from "./draft.ts"
import { Glyph } from "./icons.tsx"

/** What the inspector edits: the flow itself, one step, or how it ends. */
export type Selection = { readonly _tag: "Flow" } | { readonly _tag: "Step"; readonly index: number } | { readonly _tag: "End" }

const mediaTypes = { any: "Movies and series", movie: "Movies only", series: "Series only" } as const

/** Which activities the flow follows, in words: "Movies only", "TV Salon, iPad". */
const filterSummary = (flow: Draft) => {
  switch (flow.subject) {
    case "media":
    case "request":
      return mediaTypes[flow.filter.mediaType ?? "any"]
    case "playback": {
      const devices = flow.filter.devices ?? []
      return devices.length > 0 ? devices.join(", ") : "Every Jellyfin device"
    }
    case "day":
      return `From ${flow.filter.startsAt ?? defaultStartsAt}, or the first air time if earlier`
    case "service":
      return "Every service"
  }
}

/** "Stays 15 min on screen, ends anyway after 4 h without news" */
const endingSummary = (flow: Draft) =>
  [
    flow.lingerMinutes > 0 ? `Stays ${flow.lingerMinutes} min on screen` : "Leaves the screen at once",
    flow.expireAfterMinutes ? `ends anyway after ${shortMinutes(flow.expireAfterMinutes)} without news` : null
  ].filter(Boolean).join(", ")

/** "After the last step, or when imported" */
const endTitle = (flow: Draft, eventLabel: (type: string) => string) => {
  if (!flow.endOn) return "After the last step"
  return endsAtLastStep(flow) ? `After the last step, or when ${eventLabel(flow.endOn)}` : `When ${eventLabel(flow.endOn)}`
}

/** The shows a step has turned on, in the order the editor lists them. */
const shownKeys = (step: DraftStep) => (Object.keys(showLabels) as Array<keyof typeof showLabels>).filter((k) => step.show[k])

const tag = "rounded-md px-1.5 py-0.5 text-overline font-semibold"

/**
 * The flow read top to bottom, as it plays out: what it follows, each step with the event that
 * enters it, then how it ends. Each node opens in the inspector.
 */
export function Pipeline({ flow, events, selection, onSelect, onAddStep }: {
  flow: Draft
  events: ReadonlyArray<CatalogEvent>
  selection: Selection
  onSelect: (selection: Selection) => void
  onAddStep: (() => void) | null
}) {
  const eventOf = (type: string) => events.find((e) => e.type === type)
  const eventLabel = (type: string) => {
    const event = eventOf(type)
    const label = event ? eventName(event) : type
    return label.charAt(0).toLowerCase() + label.slice(1)
  }

  return (
    <ol className="mx-auto flex w-full max-w-150 flex-col items-stretch">
      <Node
        selected={selection._tag === "Flow"}
        onClick={() => onSelect({ _tag: "Flow" })}
        kind="Follows"
        marker={<Tile className="bg-black" style={{ boxShadow: `inset 0 0 0 1.5px ${flow.color}` }}><Glyph name={flow.icon} color={flow.color} size={18} /></Tile>}
        title={subjects[flow.subject].label}
      >
        <span className="text-body text-muted">{filterSummary(flow)}</span>
      </Node>

      {flow.steps.map((step, index) => [
        <Connector key={`c-${index}`}>
          <EventLabel label={eventLabel(step.on)} services={eventOf(step.on)?.services ?? []} />
        </Connector>,
        <StepNode
          key={`${index}-${step.id}`}
          flow={flow}
          step={step}
          index={index}
          selected={selection._tag === "Step" && selection.index === index}
          warning={skippedFor(flow, eventOf(step.on))}
          onSelect={() => onSelect({ _tag: "Step", index })}
        />
      ])}

      {onAddStep && (
        <>
          <Connector />
          <li><AddStepButton onClick={onAddStep} /></li>
        </>
      )}

      <Connector />
      <Node
        selected={selection._tag === "End"}
        onClick={() => onSelect({ _tag: "End" })}
        kind="Ends"
        marker={<Tile className="bg-raised text-muted ring-1 ring-line-strong"><Icon name="flag" size={16} /></Tile>}
        title={endTitle(flow, eventLabel)}
      >
        <span className="text-body text-muted">{endingSummary(flow)}</span>
      </Node>
    </ol>
  )
}

function Node({ selected, onClick, marker, kind, title, children }: {
  selected: boolean
  onClick: () => void
  marker: ReactNode
  kind: ReactNode
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <li className="w-full">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cx(
          "group flex w-full items-start gap-3.5 rounded-card border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow]",
          selected ? "border-accent/60 bg-raised shadow-selected" : "border-line bg-panel hover:border-line-strong hover:bg-raised/70"
        )}
      >
        <span className="mt-0.5 shrink-0">{marker}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Eyebrow>{kind}</Eyebrow>
          <span className="truncate text-subhead leading-tight font-semibold">{title}</span>
          {children}
        </span>
        <Icon name="chevronDown" size={15} className={cx("mt-1 -rotate-90 transition-colors", selected ? "text-accent" : "text-faint group-hover:text-muted")} />
      </button>
    </li>
  )
}

/** A step's node: its glyph in the flow's colour (filled once selected), what it shows, its buttons. */
function StepNode({ flow, step, index, selected, warning, onSelect }: {
  flow: Draft
  step: DraftStep
  index: number
  selected: boolean
  warning: string | null
  onSelect: () => void
}) {
  const shows = shownKeys(step)
  const actions = step.actions ?? []
  const tint = selected ? { background: flow.color } : { background: `${flow.color}1a`, boxShadow: `inset 0 0 0 1px ${flow.color}40` }
  return (
    <Node
      selected={selected}
      onClick={onSelect}
      kind={`Step ${index + 1}`}
      marker={<Tile style={tint}><Glyph name={step.icon} color={selected ? "var(--color-on-tint)" : flow.color} size={17} /></Tile>}
      title={step.label || "Untitled step"}
    >
      {shows.length > 0 || actions.length > 0
        ? (
          <span className="flex flex-wrap gap-1.5">
            {shows.map((k) => <span key={k} className={`${tag} text-muted ring-1 ring-line-strong ring-inset`}>{showLabels[k]}</span>)}
            {actions.map((a) => <ActionTag key={a} action={a} color={flow.color} />)}
          </span>
        )
        : <span className="text-body text-faint">Shows its name only</span>}
      {warning && (
        <span className="flex items-start gap-1.5 text-caption leading-snug text-warn-text">
          <Icon name="alert" size={13} className="mt-px" />
          {warning}
        </span>
      )}
    </Node>
  )
}

/** A step's button, in the flow's colour. */
function ActionTag({ action, color }: { action: keyof typeof actionLabels; color: string }) {
  return (
    <span className={`${tag} inline-flex items-center gap-1`} style={{ background: `${color}1f`, color }}>
      <Glyph name={actionGlyph(action)} color={color} size={10} />
      {actionLabels[action]}
    </span>
  )
}

/** The glyph square at the start of a node. */
function Tile({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <span className={cx("grid size-9 place-items-center rounded-tile text-body font-bold tabular-nums", className)} style={style}>{children}</span>
}

/** The line between two nodes, with the event that leads to the next one. */
function Connector({ children }: { children?: ReactNode }) {
  return (
    <li aria-hidden={children ? undefined : true} className="flex flex-col items-center">
      <span className="h-3 w-px bg-white/14" />
      {children && (
        <span className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-line-strong bg-bg px-2.5 py-1 text-caption text-muted">
          {children}
        </span>
      )}
      <span className="h-3 w-px bg-white/14" />
    </li>
  )
}

/** "⚡ When release grabbed [Radarr] [Sonarr]" */
function EventLabel({ label, services }: { label: string; services: ReadonlyArray<CatalogEvent["services"][number]> }) {
  return (
    <>
      <Icon name="bolt" size={12} className="text-faint" />
      <span>When <span className="font-semibold text-text-2">{label}</span></span>
      {services.map((s) => <span key={s} className={`${tag} bg-white/7 text-text-2`}>{serviceNames[s]}</span>)}
    </>
  )
}

function AddStepButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-card border border-dashed border-white/16 text-body font-semibold text-muted transition-colors hover:border-accent/60 hover:bg-accent/5 hover:text-accent"
    >
      <Icon name="plus" size={15} strokeWidth={2} />
      Add a step
    </button>
  )
}
