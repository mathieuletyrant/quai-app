import { flowProblem } from "@quai/api"
import { useState } from "react"
import { Badge, Button, Toggle } from "../../ui.tsx"
import { type Catalogs, type Draft, newStep, stepActions, stepEvents, subjects } from "./draft.ts"
import { EndPanel, FlowPanel, StepPanel } from "./Inspector.tsx"
import { type Selection, Pipeline } from "./Pipeline.tsx"
import { Preview } from "./Preview.tsx"

/**
 * Edits one flow: the pipeline in the middle (what it follows, its steps, how it ends), and an
 * inspector beside it for what's selected, under a live Lock Screen preview. A bar appears with
 * unsaved changes, and says what blocks saving.
 */
export function FlowEditor(props: {
  draft: Draft
  isNew: boolean
  dirty: boolean
  catalogs: Catalogs
  onChange: (change: (d: Draft) => void) => void
  onSave: () => void
  onDiscard: () => void
  onTest: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const { draft, catalogs, onChange } = props
  const [selection, setSelection] = useState<Selection>({ _tag: "Step", index: Math.min(1, draft.steps.length - 1) })
  const [previewStep, setPreviewStep] = useState(Math.min(1, draft.steps.length - 1))
  const events = stepEvents(catalogs, draft.subject)
  const actions = stepActions(catalogs, draft.subject)
  const problem = draft.name.trim() === "" ? "Give the flow a name." : flowProblem(draft)
  const last = draft.steps.length - 1
  const shown = selection._tag === "Step" ? Math.min(selection.index, last) : selection._tag === "End" ? last : Math.min(previewStep, last)

  const select = (next: Selection) => {
    setSelection(next)
    if (next._tag === "Step") setPreviewStep(next.index)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Flow name"
          value={draft.name}
          maxLength={40}
          onChange={(e) => onChange((d) => { d.name = e.target.value })}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-2xl font-bold outline-none focus:border-accent"
        />
        <Badge>{subjects[draft.subject].label}{draft.builtIn ? " · built-in" : ""}</Badge>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Toggle label="Flow on" checked={draft.enabled} onChange={(on) => onChange((d) => { d.enabled = on })} />
          {draft.enabled ? "On" : "Off"}
        </span>
        {!props.isNew && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="secondary" size="sm" disabled={props.dirty} title={props.dirty ? "Save first" : undefined} onClick={props.onTest}>Test on the iPhones</Button>
            <Button variant="secondary" size="sm" onClick={props.onDuplicate}>Duplicate</Button>
            <Button variant="ghost" size="sm" className="hover:text-danger" onClick={props.onRemove}>{draft.builtIn ? "Reset" : "Delete"}</Button>
          </div>
        )}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Pipeline
          flow={draft}
          events={events}
          selection={selection}
          onSelect={select}
          onAddStep={draft.steps.length < 6
            ? () => {
              onChange((d) => { d.steps.push(newStep(d, events)) })
              select({ _tag: "Step", index: draft.steps.length })
            }
            : null}
        />

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Preview flow={draft} step={shown} onStep={(index) => select({ _tag: "Step", index })} />
          <div className="rounded-2xl border border-line bg-panel p-5">
            {selection._tag === "Flow" && <FlowPanel flow={draft} onChange={onChange} />}
            {selection._tag === "End" && <EndPanel flow={draft} events={events} onChange={onChange} />}
            {selection._tag === "Step" && draft.steps[selection.index] && (
              <StepPanel
                flow={draft}
                index={selection.index}
                events={events}
                actions={actions}
                onChange={(next) => onChange((d) => { d.steps[selection.index] = next })}
                onMove={(delta) => {
                  onChange((d) => {
                    const [moved] = d.steps.splice(selection.index, 1)
                    d.steps.splice(selection.index + delta, 0, moved!)
                  })
                  select({ _tag: "Step", index: selection.index + delta })
                }}
                onRemove={() => {
                  onChange((d) => { d.steps.splice(selection.index, 1) })
                  select({ _tag: "Step", index: Math.max(0, selection.index - 1) })
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {(props.dirty || props.isNew) && (
        <div className="sticky bottom-4 z-40 flex flex-wrap items-center gap-3 rounded-2xl border border-white/12 bg-raised/95 px-4 py-3 shadow-2xl backdrop-blur">
          <p className={`flex-1 text-sm ${problem ? "text-danger" : "text-muted"}`}>
            {problem ?? (props.isNew ? "New flow, not saved yet." : "Unsaved changes.")}
          </p>
          <Button variant="ghost" onClick={props.onDiscard}>{props.isNew ? "Cancel" : "Discard"}</Button>
          <Button disabled={problem !== null} onClick={props.onSave}>{props.isNew ? "Create the flow" : "Save"}</Button>
        </div>
      )}
    </div>
  )
}
