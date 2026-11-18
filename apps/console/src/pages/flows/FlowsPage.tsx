import type { Flow } from "@quai/api"
import { useCallback, useEffect, useState } from "react"
import { call } from "../../client.ts"
import { Button, errorText, type Notice, PageHeader, Toast } from "../../ui.tsx"
import { type Catalogs, clone, type Draft, sameFlow, slug, subjects } from "./draft.ts"
import { FlowEditor } from "./FlowEditor.tsx"
import { Glyph } from "./icons.tsx"

/** The flows on the left, the one being edited on the right. */
export function FlowsPage() {
  const [flows, setFlows] = useState<ReadonlyArray<Flow>>([])
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
    const [all, events, actions] = await Promise.all([
      call((c) => c.flows.list()),
      call((c) => c.flows.catalog()),
      call((c) => c.flows.actions())
    ])
    setFlows(all)
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

  const test = () => run(async () => {
    if (draft === null) return
    await call((c) => c.flows.test({ params: { id: draft.id } }))
    setNotice({ ok: true, text: "Test sent to every paired iPhone: lock one to watch it (about 30 s)." })
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
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <nav aria-label="Flows" className="flex w-full shrink-0 flex-col gap-1 rounded-2xl border border-line bg-panel p-2 lg:sticky lg:top-6 lg:w-64">
          {flows.map((f) => {
            const current = !isNew && draft?.id === f.id
            return (
              <button
                key={f.id}
                type="button"
                aria-current={current}
                onClick={() => { if (!current && leave()) open(f) }}
                className="flex items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/5 aria-[current=true]:bg-raised"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-black ring-1 ring-white/10">
                  <Glyph name={f.icon} color={f.enabled ? f.color : "#5a5a60"} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-semibold ${f.enabled ? "" : "text-muted"}`}>{f.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {subjects[f.subject].label} · {f.steps.length} {f.steps.length === 1 ? "step" : "steps"}{f.enabled ? "" : " · off"}
                  </span>
                </span>
                {current && dirty && <span className="size-2 shrink-0 rounded-full bg-[#ffc230]" title="Unsaved changes" />}
              </button>
            )
          })}
          {isNew && draft && (
            <div aria-current="true" className="flex items-center gap-3 rounded-xl bg-raised p-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-black ring-1 ring-white/10">
                <Glyph name={draft.icon} color={draft.color} size={17} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{draft.name || "New flow"}</span>
              <span className="size-2 shrink-0 rounded-full bg-[#ffc230]" title="Not saved" />
            </div>
          )}

          <div className="mt-1 border-t border-line pt-2">
            {creating
              ? (
                <div className="flex flex-col gap-1">
                  <p className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted">Start from</p>
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
                  <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
                </div>
              )
              : <Button variant="ghost" className="w-full justify-start" onClick={() => setCreating(true)}>+ New flow</Button>}
          </div>
        </nav>

        {draft && (
          <FlowEditor
            key={original?.id ?? "new"}
            draft={draft}
            isNew={isNew}
            dirty={dirty}
            catalogs={catalogs}
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
