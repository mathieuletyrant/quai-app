import { type DeviceId, flowProblem } from "@quai/api"
import { type ReactNode, useState } from "react"
import { Button, IconButton, MenuItem, PageBar, Popover, Toggle } from "../../ui.tsx"
import { type Catalogs, type Draft, newStep, stepActions, stepEvents } from "./draft.ts"
import { EndPanel, FlowPanel, StepPanel } from "./Inspector.tsx"
import { type Selection, Pipeline } from "./Pipeline.tsx"
import { Preview } from "./Preview.tsx"
import { type Phone, TestMenu } from "./TestMenu.tsx"

/**
 * Edits one flow: the pipeline in the middle (what it follows, its steps, how it ends), and an
 * inspector beside it for what's selected, under a live Lock Screen preview. Save and Discard
 * appear in the top bar with unsaved changes, with what blocks saving.
 */
export function FlowEditor(props: {
  draft: Draft
  isNew: boolean
  dirty: boolean
  catalogs: Catalogs
  phones: ReadonlyArray<Phone>
  /** The page title: the flow's name, opening the other flows. */
  switcher: ReactNode
  onChange: (change: (d: Draft) => void) => void
  onSave: () => void
  onDiscard: () => void
  onTest: (deviceIds: ReadonlyArray<DeviceId>) => void
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
    <>
      <PageBar title={props.switcher}>
        <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-white/12 ring-inset">
          <Toggle label="Flow enabled" checked={draft.enabled} onChange={(on) => onChange((d) => { d.enabled = on })} />
          {draft.enabled ? "Enabled" : "Disabled"}
        </label>
        {props.dirty || props.isNew
          ? (
            <>
              <span className={`flex items-center gap-2 px-1 text-sm ${problem ? "text-danger" : "text-muted"}`}>
                {!problem && <span className="size-1.5 rounded-full bg-[#ffc230]" aria-hidden="true" />}
                {problem ?? (props.isNew ? "Not saved yet" : "Unsaved changes")}
              </span>
              <Button variant="secondary" onClick={props.onDiscard}>{props.isNew ? "Cancel" : "Discard"}</Button>
              <Button disabled={problem !== null} onClick={props.onSave}>{props.isNew ? "Create" : "Save"}</Button>
            </>
          )
          : (
            <>
              <TestMenu phones={props.phones} onTest={props.onTest} />
              <Popover
                align="right"
                trigger={({ open, toggle }) => <IconButton label="More" aria-expanded={open} onClick={toggle} className="text-lg ring-1 ring-white/12 ring-inset">⋯</IconButton>}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => { close(); props.onDuplicate() }}>Duplicate</MenuItem>
                    <MenuItem danger onClick={() => { close(); props.onRemove() }}>{draft.builtIn ? "Reset to how Quai ships it" : "Delete"}</MenuItem>
                  </>
                )}
              </Popover>
            </>
          )}
      </PageBar>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 p-4 md:p-6">
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
        </div>

        <aside className="flex flex-col gap-6 border-t border-line p-4 md:p-6 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <Preview flow={draft} step={shown} onStep={(index) => select({ _tag: "Step", index })} />
          <div className="border-t border-line pt-6">
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
    </>
  )
}
