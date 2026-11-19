import { type DeviceId, flowProblem } from "@quai/api"
import { type ReactNode, useState } from "react"
import { Button, cx, Icon, IconButton, MenuItem, PageBar, Popover, Toggle, Workspace } from "../../ui.tsx"
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
        <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-control bg-raised px-3 text-[13px] font-semibold ring-1 ring-line-strong ring-inset transition-colors hover:bg-hover">
          <Toggle label="Flow enabled" checked={draft.enabled} onChange={(on) => onChange((d) => { d.enabled = on })} />
          <span className={cx("w-[58px]", !draft.enabled && "text-muted")}>{draft.enabled ? "Enabled" : "Disabled"}</span>
        </label>
        {props.dirty || props.isNew
          ? (
            <>
              <span
                role="status"
                className={cx(
                  "flex h-9 items-center gap-2 rounded-control px-2.5 text-[13px] font-medium",
                  problem ? "text-danger-text" : "text-warn-text"
                )}
              >
                <Icon name={problem ? "alert" : "info"} size={14} />
                {problem ?? (props.isNew ? "Not saved yet" : "Unsaved changes")}
              </span>
              <Button variant="secondary" onClick={props.onDiscard}>{props.isNew ? "Cancel" : "Discard"}</Button>
              <Button icon="check" disabled={problem !== null} onClick={props.onSave}>{props.isNew ? "Create" : "Save"}</Button>
            </>
          )
          : (
            <>
              <TestMenu phones={props.phones} onTest={props.onTest} />
              <Popover
                align="right"
                className="w-64"
                trigger={({ open, toggle }) => <IconButton outlined icon="more" label="More" aria-expanded={open} onClick={toggle} />}
              >
                {(close) => (
                  <>
                    <MenuItem icon="copy" onClick={() => { close(); props.onDuplicate() }}>Duplicate</MenuItem>
                    <MenuItem danger icon={draft.builtIn ? "reset" : "trash"} onClick={() => { close(); props.onRemove() }}>
                      {draft.builtIn ? "Reset to how Quai ships it" : "Delete"}
                    </MenuItem>
                  </>
                )}
              </Popover>
            </>
          )}
      </PageBar>

      <Workspace
        canvas={
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
        }
        inspector={
          <>
            <Preview flow={draft} step={shown} onStep={(index) => select({ _tag: "Step", index })} />
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
          </>
        }
      />
    </>
  )
}
