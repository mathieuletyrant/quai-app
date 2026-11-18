import type { DeviceId, Flow } from "@quai/api"
import { useCallback, useEffect, useState } from "react"
import { call } from "../../client.ts"
import { errorText, type Notice, Toast } from "../../ui.tsx"
import { type Catalogs, clone, type Draft, sameFlow, slug } from "./draft.ts"
import { FlowEditor } from "./FlowEditor.tsx"
import { FlowSwitcher } from "./FlowSwitcher.tsx"
import type { Phone } from "./TestMenu.tsx"

/** The flows on the left, the one being edited on the right. */
export function FlowsPage() {
  const [flows, setFlows] = useState<ReadonlyArray<Flow>>([])
  const [phones, setPhones] = useState<ReadonlyArray<Phone>>([])
  const [catalogs, setCatalogs] = useState<Catalogs>({ events: [], actions: [] })
  /** The flow as saved; null while a new one is drafted. */
  const [original, setOriginal] = useState<Flow | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])

  const isNew = draft !== null && original === null
  const dirty = draft !== null && original !== null && !sameFlow(draft, original)

  const open = (flow: Flow) => {
    setOriginal(flow)
    setDraft(clone(flow))
  }

  const load = async (select?: string) => {
    const [all, events, actions, devices] = await Promise.all([
      call((c) => c.flows.list()),
      call((c) => c.flows.catalog()),
      call((c) => c.flows.actions()),
      call((c) => c.console.devices())
    ])
    setFlows(all)
    setPhones(devices)
    setCatalogs({ events, actions })
    const chosen = all.find((f) => f.id === select) ?? all[0]
    if (chosen) open(chosen)
  }

  useEffect(() => {
    load().catch((e: unknown) => setNotice({ ok: false, text: errorText(e) }))
  }, [])

  /** Leaving unsaved changes asks first. */
  const leave = () => !(dirty || isNew) || window.confirm("Discard the unsaved changes?")

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) })
    }
  }

  const save = () => run(async () => {
    if (draft === null) return
    const id = isNew ? slug(draft.name) : draft.id
    const saved = await call((c) => c.flows.save({ params: { id }, payload: { ...draft, id } }))
    setNotice({ ok: true, text: isNew ? "Flow created." : "Saved: new activities follow it from now on." })
    await load(saved.id)
  })

  const test = (deviceIds: ReadonlyArray<DeviceId>) => run(async () => {
    if (draft === null) return
    await call((c) => c.flows.test({ params: { id: draft.id }, payload: { deviceIds } }))
    setNotice({ ok: true, text: `Test sent to ${deviceIds.length === 1 ? "the iPhone" : `${deviceIds.length} iPhones`}: lock it to watch (about 30 s).` })
  })

  const remove = () => run(async () => {
    if (draft === null) return
    if (draft.builtIn) {
      if (!window.confirm(`Reset “${draft.name}” to how Quai ships it?`)) return
      await call((c) => c.flows.reset({ params: { id: draft.id } }))
      setNotice({ ok: true, text: "Back to how Quai ships it." })
      await load(draft.id)
    } else {
      if (!window.confirm(`Delete “${draft.name}”? Its running activities end.`)) return
      await call((c) => c.flows.remove({ params: { id: draft.id } }))
      setNotice({ ok: true, text: "Deleted." })
      await load()
    }
  })

  const startNew = (base: Flow, name: string) => {
    if (!leave()) return
    setOriginal(null)
    setDraft({ ...clone(base), id: "", name, builtIn: false })
  }

  return (
    <>
      {draft && (
        <FlowEditor
          key={original?.id ?? "new"}
          draft={draft}
          isNew={isNew}
          dirty={dirty || isNew}
          catalogs={catalogs}
          phones={phones}
          switcher={
            <FlowSwitcher
              flows={flows}
              current={draft}
              dirty={dirty || isNew}
              onOpen={(f) => { if (f.id !== draft.id && leave()) open(f) }}
              onNew={startNew}
            />
          }
          onChange={(change) => {
            const next = clone(draft)
            change(next)
            setDraft(next)
          }}
          onSave={save}
          onDiscard={() => { if (original) setDraft(clone(original)); else void load() }}
          onTest={test}
          onDuplicate={() => startNew(draft as Flow, `${draft.name} copy`.slice(0, 40))}
          onRemove={remove}
        />
      )}
      <Toast notice={notice} onDone={clearNotice} />
    </>
  )
}
