import type { Flow } from "@quai/api"
import { Badge, Icon, MenuItem, MenuLabel, MenuSeparator, Popover } from "../../ui"
import { type Draft, subjects } from "./draft.ts"
import { Glyph } from "./icons.tsx"

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
  return (
    <Popover
      className="w-[340px]"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-expanded={open}
          aria-label="Choose a flow"
          onClick={toggle}
          className="group -my-1 -ml-2 flex max-w-full min-w-0 items-center gap-3 rounded-card py-1.5 pr-3 pl-2 text-left transition-colors hover:bg-white/5 aria-expanded:bg-white/6"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-black" style={{ boxShadow: `inset 0 0 0 1.5px ${current.color}66` }}>
            <Glyph name={current.icon} color={current.color} size={17} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[17px] leading-6 font-semibold tracking-[-0.02em]">{current.name || "New flow"}</span>
              {dirty && <span className="size-2 shrink-0 rounded-full bg-warn" title="Unsaved changes" />}
              <Icon name="chevronDown" size={15} className="text-muted transition-colors group-hover:text-text" />
            </span>
            <span className="block truncate text-[12px] text-muted">
              {subjects[current.subject].label} · {current.builtIn ? "Built-in" : current.id ? "Custom" : "Not saved yet"}
            </span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Flows</MenuLabel>
          {flows.map((f) => (
            <MenuItem key={f.id} aria-current={f.id === current.id} className="aria-[current=true]:bg-white/7" onClick={() => { close(); onOpen(f) }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-black ring-1 ring-line">
                <Glyph name={f.icon} color={f.enabled ? f.color : "#8e8e93"} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-semibold ${f.enabled ? "" : "text-muted"}`}>{f.name}</span>
                <span className="block text-[12px] text-faint">{subjects[f.subject].label}</span>
              </span>
              {!f.enabled && <Badge>Off</Badge>}
              {f.id === current.id && <Icon name="check" size={15} className="text-accent" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>New flow</MenuLabel>
          {(Object.keys(subjects) as Array<Flow["subject"]>).map((s) => {
            const base = flows.find((f) => f.subject === s && f.builtIn)
            return base && (
              <MenuItem key={s} onClick={() => { close(); onNew(base, `My ${subjects[s].label.toLowerCase()}`) }}>
                <span className="grid size-7 shrink-0 place-items-center rounded-[8px] border border-dashed border-line-strong text-muted">
                  <Icon name="plus" size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{subjects[s].label}</span>
                  <span className="block text-[12px] text-faint">{subjects[s].description}</span>
                </span>
              </MenuItem>
            )
          })}
        </>
      )}
    </Popover>
  )
}
