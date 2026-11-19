import type { CatalogEvent } from "@quai/api"
import type { ReactNode } from "react"
import { cx, Eyebrow, Icon } from "../../ui.tsx"
import { type Draft, eventName, serviceNames, showLabels, skippedFor, subjects } from "./draft.ts"
import { Glyph } from "./icons.tsx"

/** What the inspector edits: the flow itself, one step, or how it ends. */
export type Selection = { readonly _tag: "Flow" } | { readonly _tag: "Step"; readonly index: number } | { readonly _tag: "End" }

const minutes = (m: number) => m < 60 ? `${m} min` : `${m / 60} h`

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
          selected
            ? "border-accent/60 bg-raised shadow-[0_0_0_3px_rgb(111_211_194/0.12)]"
            : "border-line bg-panel hover:border-line-strong hover:bg-raised/70"
        )}
      >
        <span className="mt-0.5 shrink-0">{marker}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Eyebrow>{kind}</Eyebrow>
          <span className="truncate text-[14.5px] leading-tight font-semibold">{title}</span>
          {children}
        </span>
        <Icon name="chevronDown" size={15} className={cx("mt-1 -rotate-90 transition-colors", selected ? "text-accent" : "text-faint group-hover:text-muted")} />
      </button>
    </li>
  )
}

/** The line between two nodes, with the event that leads to the next one. */
function Connector({ children }: { children?: ReactNode }) {
  return (
    <li aria-hidden={children ? undefined : true} className="flex flex-col items-center">
      <span className="h-3 w-px bg-white/14" />
      {children && (
        <span className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-line-strong bg-bg px-2.5 py-1 text-[12px] text-muted">
          {children}
        </span>
      )}
      <span className="h-3 w-px bg-white/14" />
    </li>
  )
}

const tile = (content: ReactNode, style: React.CSSProperties, className?: string) => (
  <span className={cx("grid size-9 place-items-center rounded-[10px] text-[13px] font-bold tabular-nums", className)} style={style}>{content}</span>
)

const tag = "rounded-md px-1.5 py-0.5 text-[11px] font-semibold"

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
  const eventLabel = (type: string) => {
    const event = events.find((e) => e.type === type)
    const label = event ? eventName(event) : type
    return label.charAt(0).toLowerCase() + label.slice(1)
  }
  const sources = (type: string) =>
    (events.find((e) => e.type === type)?.services ?? []).map((s) => (
      <span key={s} className={`${tag} bg-white/7 text-text-2`}>{serviceNames[s]}</span>
    ))
  const filter = flow.subject === "media"
    ? { any: "Movies and series", movie: "Movies only", series: "Series only" }[flow.filter.mediaType ?? "any"]
    : flow.subject === "playback"
    ? (flow.filter.devices ?? []).length > 0 ? (flow.filter.devices ?? []).join(", ") : "Every Jellyfin device"
    : "Every service"
  const ending = [
    flow.lingerMinutes > 0 ? `Stays ${flow.lingerMinutes} min on screen` : "Leaves the screen at once",
    flow.expireAfterMinutes ? `ends anyway after ${minutes(flow.expireAfterMinutes)} without news` : null
  ].filter(Boolean).join(", ")

  return (
    <ol className="mx-auto flex w-full max-w-[600px] flex-col items-stretch">
      <Node
        selected={selection._tag === "Flow"}
        onClick={() => onSelect({ _tag: "Flow" })}
        kind="Follows"
        marker={tile(<Glyph name={flow.icon} color={flow.color} size={18} />, { background: "#000", boxShadow: `inset 0 0 0 1.5px ${flow.color}` })}
        title={subjects[flow.subject].label}
      >
        <span className="text-[13px] text-muted">{filter}</span>
      </Node>

      {flow.steps.map((step, index) => {
        const selected = selection._tag === "Step" && selection.index === index
        const shows = (Object.keys(showLabels) as Array<keyof typeof showLabels>).filter((k) => step.show[k])
        const warning = skippedFor(flow, events.find((e) => e.type === step.on))
        return [
          <Connector key={`c-${index}`}>
            <Icon name="bolt" size={12} className="text-faint" />
            <span>When <span className="font-semibold text-text-2">{eventLabel(step.on)}</span></span>
            {sources(step.on)}
          </Connector>,
          <Node
            key={`${index}-${step.id}`}
            selected={selected}
            onClick={() => onSelect({ _tag: "Step", index })}
            kind={`Step ${index + 1}`}
            marker={tile(
              <Glyph name={step.icon} color={selected ? "#0b0b0f" : flow.color} size={17} />,
              selected ? { background: flow.color } : { background: `${flow.color}1a`, boxShadow: `inset 0 0 0 1px ${flow.color}40` }
            )}
            title={step.label || "Untitled step"}
          >
            {(shows.length > 0 || (step.actions ?? []).length > 0) && (
              <span className="flex flex-wrap gap-1.5">
                {shows.map((k) => <span key={k} className={`${tag} text-muted ring-1 ring-line-strong ring-inset`}>{showLabels[k]}</span>)}
                {(step.actions ?? []).map((a) => (
                  <span key={a} className={`${tag} inline-flex items-center gap-1`} style={{ background: `${flow.color}1f`, color: flow.color }}>
                    <Glyph name={a === "playback.stop" ? "stop.fill" : "play.fill"} color={flow.color} size={10} />
                    {a === "playback.stop" ? "Stop" : "Play / Pause"}
                  </span>
                ))}
              </span>
            )}
            {!shows.length && !(step.actions ?? []).length && <span className="text-[13px] text-faint">Shows its name only</span>}
            {warning && (
              <span className="flex items-start gap-1.5 text-[12px] leading-snug text-warn-text">
                <Icon name="alert" size={13} className="mt-px" />
                {warning}
              </span>
            )}
          </Node>
        ]
      })}

      {onAddStep && (
        <>
          <Connector />
          <li>
            <button
              type="button"
              onClick={onAddStep}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-card border border-dashed border-white/16 text-[13px] font-semibold text-muted transition-colors hover:border-accent/60 hover:bg-accent/5 hover:text-accent"
            >
              <Icon name="plus" size={15} strokeWidth={2} />
              Add a step
            </button>
          </li>
        </>
      )}

      <Connector />
      <Node
        selected={selection._tag === "End"}
        onClick={() => onSelect({ _tag: "End" })}
        kind="Ends"
        marker={tile(<Icon name="flag" size={16} />, {}, "bg-raised text-muted ring-1 ring-line-strong")}
        title={flow.endOn ? `When ${eventLabel(flow.endOn)}` : "After the last step"}
      >
        <span className="text-[13px] text-muted">{ending}</span>
      </Node>
    </ol>
  )
}
