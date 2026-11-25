import type { Flow } from "@quai/api"
import { Badge, Icon, MenuItem, MenuLabel, MenuSeparator, Popover } from "../../ui"
import { type Draft, subjects } from "./draft.ts"
import { Glyph } from "./icons.tsx"

/** "Built-in", "Custom", "Not saved yet" */
const origin = (flow: Draft) => flow.builtIn ? "Built-in" : flow.id ? "Custom" : "Not saved yet"

/**
 * The flow being edited, as the page title: opens the list of flows, and new ones started from
 * a built-in flow of each kind.
 */
export function FlowSwitcher({ flows, current, dirty, onOpen, onNew }: {
  flows: ReadonlyArray<Flow>
  current: Draft
  dirty: boolean
  onOpen: (flow: Flow) => void
  onNew: (base: Flow, name: string) => void
}) {
  const subjectsWithBase = (Object.keys(subjects) as Array<Flow["subject"]>).flatMap((subject) => {
    const base = flows.find((flow) => flow.subject === subject && flow.builtIn)
    return base ? [{ subject, base }] : []
  })
  return (
    <Popover
      className="w-85"
      trigger={({ open, toggle }) => <Trigger flow={current} dirty={dirty} open={open} onClick={toggle} />}
    >
      {(close) => (
        <>
          <MenuLabel>Flows</MenuLabel>
          {flows.map((flow) => (
            <FlowItem
              key={flow.id}
              flow={flow}
              current={flow.id === current.id}
              onClick={() => {
                close()
                onOpen(flow)
              }}
            />
          ))}
          <MenuSeparator />
          <MenuLabel>New flow</MenuLabel>
          {subjectsWithBase.map(({ subject, base }) => (
            <NewFlowItem
              key={subject}
              subject={subject}
              onClick={() => {
                close()
                onNew(base, `My ${subjects[subject].label.toLowerCase()}`)
              }}
            />
          ))}
        </>
      )}
    </Popover>
  )
}

/** The page title: the flow's glyph, name and kind, with a dot while it has unsaved changes. */
function Trigger({ flow, dirty, open, onClick }: { flow: Draft; dirty: boolean; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label="Choose a flow"
      onClick={onClick}
      className="group -my-1 -ml-2 flex max-w-full min-w-0 items-center gap-3 rounded-card py-1.5 pr-3 pl-2 text-left transition-colors hover:bg-white/5 aria-expanded:bg-white/6"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-tile bg-black"
        style={{ boxShadow: `inset 0 0 0 1.5px ${flow.color}66` }}
      >
        <Glyph name={flow.icon} color={flow.color} size={17} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-heading leading-6 font-semibold tracking-title">
            {flow.name || "New flow"}
          </span>
          {dirty && <span className="size-2 shrink-0 rounded-full bg-warn" title="Unsaved changes" />}
          <Icon name="chevronDown" size={15} className="text-muted transition-colors group-hover:text-text" />
        </span>
        <span className="block truncate text-caption text-muted">{subjects[flow.subject].label} · {origin(flow)}</span>
      </span>
    </button>
  )
}

/** A saved flow in the menu, greyed while it's off. */
function FlowItem({ flow, current, onClick }: { flow: Flow; current: boolean; onClick: () => void }) {
  return (
    <MenuItem aria-current={current} className="aria-[current=true]:bg-white/7" onClick={onClick}>
      <span className="grid size-7 shrink-0 place-items-center rounded-item bg-black ring-1 ring-line">
        <Glyph name={flow.icon} color={flow.enabled ? flow.color : "var(--color-faint)"} size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold ${flow.enabled ? "" : "text-muted"}`}>{flow.name}</span>
        <span className="block text-caption text-faint">{subjects[flow.subject].label}</span>
      </span>
      {!flow.enabled && <Badge>Off</Badge>}
      {current && <Icon name="check" size={15} className="text-accent" />}
    </MenuItem>
  )
}

/** Starts a new flow of one kind, from its built-in flow. */
function NewFlowItem({ subject, onClick }: { subject: Flow["subject"]; onClick: () => void }) {
  return (
    <MenuItem onClick={onClick}>
      <span className="grid size-7 shrink-0 place-items-center rounded-item border border-dashed border-line-strong text-muted">
        <Icon name="plus" size={14} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{subjects[subject].label}</span>
        <span className="block text-caption text-faint">{subjects[subject].description}</span>
      </span>
    </MenuItem>
  )
}
