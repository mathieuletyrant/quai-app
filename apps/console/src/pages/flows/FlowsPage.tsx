import type { DeviceId, Flow } from "@quai/api"
import { useCallback, useEffect, useState } from "react"
import { call } from "../../client.ts"
import { Button, errorText, type Notice, PageHeader, Toast } from "../../ui.tsx"
import { type Catalogs, clone, type Draft, sameFlow, slug, subjects } from "./draft.ts"
import { FlowEditor } from "./FlowEditor.tsx"
import { Glyph } from "./icons.tsx"
import type { Phone } from "./TestMenu.tsx"

/** The flows on the left, the one being edited on the right. */
export function FlowsPage() {
  const [flows, setFlows] = useState<ReadonlyArray<Flow>>([])
  const [phones, setPhones] = useState<ReadonlyArray<Phone>>([])
  const [catalogs, setCatalogs] = useState<Catalogs>({ events: [], actions: [] })
  /** The flow as saved; null while a new one is drafted. */
  const [original, setOriginal] = useState<Flow | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])

  const isNew = draft !== null && original === null
  const dirty = draft !== null && original !== null && !sameFlow(draft, original)

  const open = (flow: Flow) => {
    setOriginal(flow)
    setDraft(clone(flow))
    setCreating(false)
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
    setCreating(false)
  }

  return (
    <>
      <PageHeader
        title="Flows"
        subtitle="What starts a Live Activity, the steps it goes through and what each one shows. Each iPhone then picks its own steps."
      />
      <div className="flex flex-col gap-6">
        <nav aria-label="Flows" className="relative flex flex-wrap items-center gap-2 border-b border-line pb-4">
          {flows.map((f) => {
            const current = !isNew && draft?.id === f.id
            return (
              <button
                key={f.id}
                type="button"
                aria-current={current}
                onClick={() => { if (!current && leave()) open(f) }}
                className="flex h-10 items-center gap-2 rounded-full border border-line px-3.5 text-sm font-semibold text-muted transition hover:border-white/20 hover:text-text aria-[current=true]:border-white/25 aria-[current=true]:bg-raised aria-[current=true]:text-text"
              >
                <Glyph name={f.icon} color={f.enabled ? f.color : "#5a5a60"} size={15} />
                {f.name}
                {!f.enabled && <span className="text-xs font-normal text-muted">off</span>}
                {current && dirty && <span className="size-2 rounded-full bg-[#ffc230]" title="Unsaved changes" />}
              </button>
            )
          })}
          {isNew && draft && (
            <span aria-current="true" className="flex h-10 items-center gap-2 rounded-full border border-white/25 bg-raised px-3.5 text-sm font-semibold">
              <Glyph name={draft.icon} color={draft.color} size={15} />
              {draft.name || "New flow"}
              <span className="size-2 rounded-full bg-[#ffc230]" title="Not saved" />
            </span>
          )}
          <Button variant="ghost" aria-expanded={creating} onClick={() => setCreating(!creating)}>+ New flow</Button>
          {creating && (
            <div className="absolute top-12 z-30 flex w-80 flex-col gap-1 rounded-2xl border border-white/12 bg-raised p-2 shadow-2xl">
              <p className="px-2.5 pt-1 pb-1 text-xs font-semibold text-muted">Start from</p>
              {(Object.keys(subjects) as Array<Flow["subject"]>).map((s) => {
                const base = flows.find((f) => f.subject === s && f.builtIn)
                return base && (
                  <button
                    key={s}
                    type="button"
                    onClick={() => startNew(base, `My ${subjects[s].label.toLowerCase()}`)}
                    className="flex items-start gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/5"
                  >
                    <Glyph name={subjects[s].icon} color="#6fd3c2" size={17} />
                    <span>
                      <span className="block text-sm font-semibold">{subjects[s].label}</span>
                      <span className="block text-xs text-muted">{subjects[s].description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </nav>

        {draft && (
          <FlowEditor
            key={original?.id ?? "new"}
            draft={draft}
            isNew={isNew}
            dirty={dirty}
            catalogs={catalogs}
            phones={phones}
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
      </div>
      <Toast notice={notice} onDone={clearNotice} />
    </>
  )
}
