import type { CatalogEvent } from "@quai/api"
import type { ReactNode } from "react"
import { type Draft, eventName, serviceNames, showLabels, skippedFor, subjects } from "./draft.ts"
import { Glyph } from "./icons.tsx"

/** What the inspector edits: the flow itself, one step, or how it ends. */
export type Selection = { readonly _tag: "Flow" } | { readonly _tag: "Step"; readonly index: number } | { readonly _tag: "End" }

const minutes = (m: number) => m < 60 ? `${m} min` : `${m / 60} h`

function Node({ selected, onClick, marker, title, children, last }: {
  selected: boolean
  onClick: () => void
  marker: ReactNode
  title: ReactNode
  children?: ReactNode
  last?: boolean
}) {
  return (
    <li className="relative flex gap-4 pb-3">
      {!last && <span aria-hidden="true" className="absolute top-11 -bottom-1 left-[19px] w-0.5 bg-white/10" />}
      <span className="relative mt-2 shrink-0">{marker}</span>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl border border-line bg-panel px-4 py-3 text-left transition hover:border-white/20 aria-pressed:border-accent aria-pressed:bg-raised"
      >
        <span className="text-[15px] font-semibold">{title}</span>
        {children}
      </button>
    </li>
  )
}

const dot = (content: ReactNode, style: React.CSSProperties) => (
  <span className="grid size-10 place-items-center rounded-full text-sm font-bold" style={style}>{content}</span>
)

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
  const sources = (type: string) => (
    <span className="flex flex-wrap gap-1">
      {(events.find((e) => e.type === type)?.services ?? []).map((s) => (
        <span key={s} className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] font-semibold text-[#d1d1d6]">{serviceNames[s]}</span>
      ))}
    </span>
  )
  const filter = flow.subject === "media"
    ? { any: "Movies and series", movie: "Movies only", series: "Series only" }[flow.filter.mediaType ?? "any"]
    : flow.subject === "playback"
    ? (flow.filter.devices ?? []).length > 0 ? (flow.filter.devices ?? []).join(", ") : "Every Jellyfin device"
    : "Every service"
  const ending = [
    flow.endOn ? `When ${eventLabel(flow.endOn)}` : "After the last step",
    flow.lingerMinutes > 0 ? `stays ${flow.lingerMinutes} min` : null,
    flow.expireAfterMinutes ? `or after ${minutes(flow.expireAfterMinutes)} without news` : null
  ].filter(Boolean).join(", ")

  return (
    <ol>
      <Node
        selected={selection._tag === "Flow"}
        onClick={() => onSelect({ _tag: "Flow" })}
        marker={dot(<Glyph name={flow.icon} color={flow.color} size={18} />, { background: "#000", boxShadow: `inset 0 0 0 1.5px ${flow.color}` })}
        title={<>Follows <span className="text-muted">·</span> {subjects[flow.subject].label}</>}
      >
        <span className="text-[13px] text-muted">{filter}</span>
      </Node>

      {flow.steps.map((step, index) => {
        const selected = selection._tag === "Step" && selection.index === index
        const shows = (Object.keys(showLabels) as Array<keyof typeof showLabels>).filter((k) => step.show[k])
        const warning = skippedFor(flow, events.find((e) => e.type === step.on))
        return (
          <Node
            key={`${index}-${step.id}`}
            selected={selected}
            onClick={() => onSelect({ _tag: "Step", index })}
            marker={dot(index + 1, selected ? { background: flow.color, color: "#0b0b0f" } : { background: "#1f1f26", color: "#a1a1a6" })}
            title={
              <span className="flex items-center gap-2">
                <Glyph name={step.icon} color={flow.color} size={16} />
                {step.label || "Untitled step"}
              </span>
            }
          >
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted">When {eventLabel(step.on)} {sources(step.on)}</span>
            {(shows.length > 0 || (step.actions ?? []).length > 0) && (
              <span className="flex flex-wrap gap-1.5">
                {shows.map((k) => <span key={k} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/15 ring-inset text-muted">Shows {showLabels[k].toLowerCase()}</span>)}
                {(step.actions ?? []).map((a) => <span key={a} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `${flow.color}26`, color: flow.color }}>{a === "playback.stop" ? "Stop" : "Play / Pause"}</span>)}
              </span>
            )}
            {warning && <span className="text-[12px] text-[#ffc230]">{warning}</span>}
          </Node>
        )
      })}

      {onAddStep && (
        <li className="relative flex gap-4 pb-3">
          <span aria-hidden="true" className="absolute top-0 -bottom-1 left-[19px] w-0.5 bg-white/10" />
          <span className="relative grid size-10 shrink-0 place-items-center" />
          <button type="button" onClick={onAddStep} className="h-10 rounded-xl border border-dashed border-white/20 px-4 text-sm font-semibold text-muted transition hover:border-accent hover:text-accent">
            + Add a step
          </button>
        </li>
      )}

      <Node
        last
        selected={selection._tag === "End"}
        onClick={() => onSelect({ _tag: "End" })}
        marker={dot("■", { background: "#1f1f26", color: "#a1a1a6" })}
        title="Ends"
      >
        <span className="text-[13px] text-muted">{ending}</span>
      </Node>
    </ol>
  )
}
