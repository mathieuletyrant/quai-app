import { type DeviceId, flowProblem } from "@quai/api"
import { type ReactNode, useState } from "react"
import { Button, cx, Icon, IconButton, MenuItem, PageBar, Popover, Toggle, Workspace } from "../../ui"
import { type Catalogs, type Draft, newStep, stepActions, stepEvents } from "./draft.ts"
import { EndPanel, FlowPanel, StepPanel } from "./Inspector.tsx"
import { Pipeline, type Selection } from "./Pipeline.tsx"
import { Preview } from "./Preview.tsx"
import { type Phone, TestMenu } from "./TestMenu.tsx"

const maxSteps = 6

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
  onChange: (change: (draft: Draft) => void) => void
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
  const shown = selection._tag === "Step"
    ? Math.min(selection.index, last)
    : selection._tag === "End"
    ? last
    : Math.min(previewStep, last)

  const select = (next: Selection) => {
    setSelection(next)
    if (next._tag === "Step") setPreviewStep(next.index)
  }
  const addStep = () => {
    onChange((edited) => {
      edited.steps.push(newStep(edited, events))
    })
    select({ _tag: "Step", index: draft.steps.length })
  }
  const moveStep = (index: number, delta: -1 | 1) => {
    onChange((edited) => {
      const [moved] = edited.steps.splice(index, 1)
      edited.steps.splice(index + delta, 0, moved!)
    })
    select({ _tag: "Step", index: index + delta })
  }
  const removeStep = (index: number) => {
    onChange((edited) => {
      edited.steps.splice(index, 1)
    })
    select({ _tag: "Step", index: Math.max(0, index - 1) })
  }

  return (
    <>
      <PageBar title={props.switcher}>
        <EnabledToggle
          enabled={draft.enabled}
          onChange={(on) =>
            onChange((edited) => {
              edited.enabled = on
            })}
        />
        {props.dirty || props.isNew
          ? <SaveBar isNew={props.isNew} problem={problem} onSave={props.onSave} onDiscard={props.onDiscard} />
          : (
            <>
              <TestMenu phones={props.phones} onTest={props.onTest} />
              <FlowMenu builtIn={draft.builtIn} onDuplicate={props.onDuplicate} onRemove={props.onRemove} />
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
            onAddStep={draft.steps.length < maxSteps ? addStep : null}
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
                onChange={(next) =>
                  onChange((edited) => {
                    edited.steps[selection.index] = next
                  })}
                onMove={(delta) => moveStep(selection.index, delta)}
                onRemove={() => removeStep(selection.index)}
              />
            )}
          </>
        }
      />
    </>
  )
}

/** The flow's on/off switch, with its state in words. */
function EnabledToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-control bg-raised px-3 text-body font-semibold ring-1 ring-line-strong ring-inset transition-colors hover:bg-hover">
      <Toggle label="Flow enabled" checked={enabled} onChange={onChange} />
      <span className={cx("w-14.5", !enabled && "text-muted")}>{enabled ? "Enabled" : "Disabled"}</span>
    </label>
  )
}

/** With unsaved changes: what blocks saving (or that it isn't saved), Discard and Save. */
function SaveBar(
  { isNew, problem, onSave, onDiscard }: {
    isNew: boolean
    problem: string | null
    onSave: () => void
    onDiscard: () => void
  }
) {
  return (
    <>
      <span
        role="status"
        className={cx(
          "flex h-9 items-center gap-2 rounded-control px-2.5 text-body font-medium",
          problem ? "text-danger-text" : "text-warn-text"
        )}
      >
        <Icon name={problem ? "alert" : "info"} size={14} />
        {problem ?? (isNew ? "Not saved yet" : "Unsaved changes")}
      </span>
      <Button variant="secondary" onClick={onDiscard}>{isNew ? "Cancel" : "Discard"}</Button>
      <Button icon="check" disabled={problem !== null} onClick={onSave}>{isNew ? "Create" : "Save"}</Button>
    </>
  )
}

/** Duplicate, and Delete (or Reset, for a built-in flow). */
function FlowMenu(
  { builtIn, onDuplicate, onRemove }: { builtIn: boolean; onDuplicate: () => void; onRemove: () => void }
) {
  return (
    <Popover
      align="right"
      className="w-64"
      trigger={({ open, toggle }) => (
        <IconButton outlined icon="more" label="More" aria-expanded={open} onClick={toggle} />
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon="copy"
            onClick={() => {
              close()
              onDuplicate()
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            danger
            icon={builtIn ? "reset" : "trash"}
            onClick={() => {
              close()
              onRemove()
            }}
          >
            {builtIn ? "Reset to how Quai ships it" : "Delete"}
          </MenuItem>
        </>
      )}
    </Popover>
  )
}
