import type { Flow } from "@quai/api"
import { MenuItem, Popover } from "../../ui.tsx"
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
      className="w-80"
      trigger={({ open, toggle }) => (
        <button type="button" aria-expanded={open} aria-label="Choose a flow" onClick={toggle} className="group flex min-w-0 items-center gap-3 rounded-2xl py-1 pr-2 text-left">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-black ring-1 ring-white/10">
            <Glyph name={current.icon} color={current.color} size={20} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-2xl font-bold">
              <span className="truncate">{current.name || "New flow"}</span>
              {dirty && <span className="size-2 shrink-0 rounded-full bg-[#ffc230]" title="Unsaved changes" />}
              <span className="text-base text-muted transition group-hover:text-text" aria-hidden="true">▾</span>
            </span>
            <span className="block text-[13px] text-muted">
              {subjects[current.subject].label} · {current.builtIn ? "built-in" : current.id ? "custom" : "not saved yet"}
            </span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          {flows.map((f) => (
            <MenuItem key={f.id} aria-current={f.id === current.id} className="aria-[current=true]:bg-white/8" onClick={() => { close(); onOpen(f) }}>
              <Glyph name={f.icon} color={f.enabled ? f.color : "#5a5a60"} size={16} />
              <span className="flex-1 font-semibold">{f.name}</span>
              <span className="text-xs text-muted">{f.enabled ? subjects[f.subject].label : "off"}</span>
            </MenuItem>
          ))}
          <p className="mt-1 border-t border-line px-3 pt-2.5 pb-1 text-xs font-semibold text-muted">New flow</p>
          {(Object.keys(subjects) as Array<Flow["subject"]>).map((s) => {
            const base = flows.find((f) => f.subject === s && f.builtIn)
            return base && (
              <MenuItem key={s} onClick={() => { close(); onNew(base, `My ${subjects[s].label.toLowerCase()}`) }}>
                <Glyph name={subjects[s].icon} color="#6fd3c2" size={16} />
                <span>
                  <span className="block font-semibold">{subjects[s].label}</span>
                  <span className="block text-xs text-muted">{subjects[s].description}</span>
                </span>
              </MenuItem>
            )
          })}
        </>
      )}
    </Popover>
  )
}
