import type { Flow, FlowStep } from "@quai/api"
import { useCallback, useEffect, useMemo, useState } from "react"
import { call } from "../client.ts"
import { Glyph, icons } from "./icons.tsx"

type CatalogEntry = { readonly type: FlowStep["on"]; readonly subject: Flow["subject"]; readonly label: string; readonly data: boolean }
type ActionEntry = { readonly type: NonNullable<FlowStep["actions"]>[number]; readonly subject: Flow["subject"]; readonly label: string }
const actionGlyphs: Record<ActionEntry["type"], string> = { "playback.playPause": "⏯", "playback.stop": "⏹" }
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Array<Mutable<U>> : T[K] extends object ? Mutable<T[K]> : T[K] }
type Draft = Mutable<Flow>

const palette = ["#FFC230", "#B57EDC", "#4FC3F7", "#FF6B5B", "#8B8CF8", "#6FD3C2", "#30D158", "#FF8A3D"]
const subjects: Record<Flow["subject"], string> = { media: "Downloads", playback: "Playback", service: "Server health" }
const shows = [
  { key: "progress", label: "Progress %" },
  { key: "speed", label: "Speed" },
  { key: "eta", label: "Time left" },
  { key: "timer", label: "Countdown to end" },
  { key: "since", label: "Time since" }
] as const

const slug = (text: string) => text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "flow"
const clone = (flow: Flow): Draft => JSON.parse(JSON.stringify(flow)) as Draft

function Preview({ flow, step }: { flow: Draft; step: number }) {
  const current = flow.steps[step]
  if (current === undefined) return null
  const done = flow.endOn === undefined && step === flow.steps.length - 1
  const tint = done ? "#30D158" : flow.color
  return (
    <div className="preview" aria-label="Lock Screen preview">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="tile"><Glyph name={current.icon} color={tint} size={20} /></span>
        <div className="grow">
          <p style={{ margin: 0, fontWeight: 600 }}>{flow.subject === "service" ? "Radarr" : "Big Buck Bunny"}</p>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            {current.label}{current.show.eta ? " · ≈ 4 min" : ""}{current.show.speed ? " · 11 MB/s" : ""}{current.show.timer ? " · ends 22:41" : ""}{current.show.since ? " · for 7 min" : ""}
          </p>
        </div>
        {current.show.progress && <span style={{ color: tint, fontWeight: 700, fontSize: 20 }}>63 %</span>}
        {current.show.timer && <span style={{ color: tint, fontWeight: 700, fontSize: 20 }}>38:12</span>}
      </div>
      {(current.show.progress || current.show.timer) && <div className="bar"><div style={{ width: current.show.timer ? "34%" : "63%", background: tint }} /></div>}
      {(current.actions ?? []).length > 0 && (
        <div className="checks">
          {(current.actions ?? []).map((a) => <span key={a} className="action-preview" style={{ color: tint }}>{actionGlyphs[a]}</span>)}
        </div>
      )}
      {flow.steps.length > 1 && <div className="stepper">
        {flow.steps.map((s, i) => (
          <div key={s.id} className="grow">
            <div className="tick" style={{ background: i <= step ? tint : "rgba(255,255,255,0.14)" }} />
            <span style={{ opacity: i === step ? 0.95 : 0.5, fontWeight: i === step ? 600 : 400 }}>{s.label}</span>
          </div>
        ))}
      </div>}
    </div>
  )
}

function StepRow(props: {
  step: Draft["steps"][number]
  index: number
  count: number
  events: ReadonlyArray<CatalogEntry>
  actions: ReadonlyArray<ActionEntry>
  onChange: (step: Draft["steps"][number]) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { step, index, count, events } = props
  return (
    <div className="step">
      <div className="step-head">
        <span className="pill">{index + 1}</span>
        <input aria-label="Step label" value={step.label} maxLength={24} onChange={(e) => props.onChange({ ...step, label: e.target.value })} />
        <select aria-label="Step icon" value={step.icon} onChange={(e) => props.onChange({ ...step, icon: e.target.value })}>
          {icons.map((i) => <option key={i.name} value={i.name}>{i.label}</option>)}
        </select>
        <button type="button" className="icon-button" aria-label="Move up" disabled={index === 0} onClick={() => props.onMove(-1)}>↑</button>
        <button type="button" className="icon-button" aria-label="Move down" disabled={index === count - 1} onClick={() => props.onMove(1)}>↓</button>
        <button type="button" className="icon-button" aria-label="Remove step" disabled={count <= 1} onClick={props.onRemove}>✕</button>
      </div>
      <label className="field">
        <span>Starts when</span>
        <select value={step.on} onChange={(e) => props.onChange({ ...step, on: e.target.value as FlowStep["on"] })}>
          {events.map((e) => <option key={e.type} value={e.type}>{e.label}</option>)}
        </select>
      </label>
      <div className="checks">
        {shows.map((s) => (
          <label key={s.key} className="check">
            <input type="checkbox" checked={step.show[s.key] === true} onChange={(e) => props.onChange({ ...step, show: { ...step.show, [s.key]: e.target.checked } })} />
            {s.label}
          </label>
        ))}
      </div>
      {props.actions.length > 0 && (
        <div className="checks">
          <span className="muted" style={{ fontSize: 13 }}>Buttons</span>
          {props.actions.map((a) => (
            <label key={a.type} className="check">
              <input
                type="checkbox"
                checked={(step.actions ?? []).includes(a.type)}
                onChange={(e) => props.onChange({
                  ...step,
                  actions: e.target.checked ? [...(step.actions ?? []), a.type] : (step.actions ?? []).filter((x) => x !== a.type)
                })}
              />
              {a.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function FlowsPage() {
  const [flows, setFlows] = useState<ReadonlyArray<Flow>>([])
  const [catalog, setCatalog] = useState<ReadonlyArray<CatalogEntry>>([])
  const [actionCatalog, setActionCatalog] = useState<ReadonlyArray<ActionEntry>>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [previewStep, setPreviewStep] = useState(1)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (select?: string) => {
    const [all, events, actions] = await Promise.all([
      call((c) => c.flows.list()),
      call((c) => c.flows.catalog()),
      call((c) => c.flows.actions())
    ])
    setFlows(all)
    setCatalog(events)
    setActionCatalog(actions)
    const chosen = all.find((f) => f.id === (select ?? draft?.id)) ?? all[0]
    if (chosen) {
      setDraft(clone(chosen))
      setIsNew(false)
    }
  }, [draft?.id])

  useEffect(() => {
    load().catch((e: unknown) => setMessage({ ok: false, text: String(e) }))
  }, [])

  const stepEvents = useMemo(
    () => catalog.filter((e) => !e.data && draft !== null && e.subject === draft.subject),
    [catalog, draft?.subject]
  )

  const stepActions = useMemo(
    () => actionCatalog.filter((a) => draft !== null && a.subject === draft.subject),
    [actionCatalog, draft?.subject]
  )

  const fail = (e: unknown) => {
    const text = typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e)
    setMessage({ ok: false, text })
  }

  const save = async () => {
    if (draft === null) return
    const id = isNew ? slug(draft.name) : draft.id
    try {
      const saved = await call((c) => c.flows.save({ params: { id }, payload: { ...draft, id } }))
      setMessage({ ok: true, text: "Saved. New activities follow it from now on." })
      await load(saved.id)
    } catch (e) {
      fail(e)
    }
  }

  const test = async () => {
    if (draft === null || isNew) return
    try {
      await call((c) => c.flows.test({ params: { id: draft.id } }))
      setMessage({ ok: true, text: "Test sent to every paired iPhone: lock one to watch it (about 30 s)." })
    } catch (e) {
      fail(e)
    }
  }

  const duplicate = () => {
    if (draft === null) return
    setDraft({ ...draft, id: "", name: `${draft.name} copy`, builtIn: false })
    setIsNew(true)
    setMessage(null)
  }

  const create = (subject: Flow["subject"]) => {
    const template = flows.find((f) => f.subject === subject && f.builtIn) ?? flows[0]
    if (template === undefined) return
    setDraft({ ...clone(template), id: "", name: `My ${subjects[subject].toLowerCase()}`, builtIn: false })
    setIsNew(true)
    setMessage(null)
  }

  const remove = async () => {
    if (draft === null) return
    try {
      if (draft.builtIn) {
        await call((c) => c.flows.reset({ params: { id: draft.id } }))
        setMessage({ ok: true, text: "Back to how Quai ships it." })
        await load(draft.id)
      } else {
        await call((c) => c.flows.remove({ params: { id: draft.id } }))
        setMessage({ ok: true, text: "Deleted." })
        await load("download")
      }
    } catch (e) {
      fail(e)
    }
  }

  const update = (change: (d: Draft) => void) => {
    if (draft === null) return
    const next = clone(draft as Flow)
    change(next)
    setDraft(next)
  }

  return (
    <>
      <div>
        <h1>Flows</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          What starts a Live Activity, the steps it goes through and what each one shows. Each iPhone then picks its own steps.
        </p>
      </div>
      <div className="flows">
        <div className="panel flow-list">
          {flows.map((f) => (
            <button
              type="button"
              key={f.id}
              className="flow-item"
              aria-current={draft?.id === f.id && !isNew}
              onClick={() => {
                setDraft(clone(f))
                setIsNew(false)
                setMessage(null)
                setPreviewStep(Math.min(1, f.steps.length - 1))
              }}
            >
              <span className="dot" style={{ background: f.color }} />
              <span className="grow">{f.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{f.enabled ? (f.builtIn ? "built-in" : "custom") : "off"}</span>
            </button>
          ))}
          <div className="new-flow">
            <span className="muted" style={{ fontSize: 13 }}>New flow</span>
            {(Object.keys(subjects) as Array<Flow["subject"]>).map((s) => (
              <button type="button" key={s} className="button secondary small" onClick={() => create(s)}>{subjects[s]}</button>
            ))}
          </div>
        </div>

        {draft && (
          <div className="panel flow-editor">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="dot" style={{ width: 14, height: 14, background: draft.color }} />
              <input className="title-input" aria-label="Flow name" value={draft.name} maxLength={40} onChange={(e) => update((d) => { d.name = e.target.value })} />
              <label className="check">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => update((d) => { d.enabled = e.target.checked })} />
                On
              </label>
            </div>

            <Preview flow={draft} step={Math.min(previewStep, draft.steps.length - 1)} />
            <div className="checks">
              {draft.steps.map((s, i) => (
                <button type="button" key={s.id} className="button secondary small" aria-pressed={i === Math.min(previewStep, draft.steps.length - 1)} onClick={() => setPreviewStep(i)}>{s.label}</button>
              ))}
            </div>

            <div className="form">
              <div className="field">
                <span>Color</span>
                <div className="swatches">
                  {palette.map((c) => (
                    <button type="button" key={c} className="swatch" aria-label={c} aria-pressed={draft.color === c} style={{ background: c }} onClick={() => update((d) => { d.color = c })} />
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Icon</span>
                <select value={draft.icon} onChange={(e) => update((d) => { d.icon = e.target.value })}>
                  {icons.map((i) => <option key={i.name} value={i.name}>{i.label}</option>)}
                </select>
              </label>
              {draft.subject === "media" && (
                <label className="field">
                  <span>Titles</span>
                  <select value={draft.filter.mediaType ?? "any"} onChange={(e) => update((d) => { d.filter.mediaType = e.target.value as "any" })}>
                    <option value="any">Movies and series</option>
                    <option value="movie">Movies only</option>
                    <option value="series">Series only</option>
                  </select>
                </label>
              )}
              {draft.subject === "playback" && (
                <label className="field">
                  <span>Jellyfin devices (empty: all)</span>
                  <input
                    value={(draft.filter.devices ?? []).join(", ")}
                    placeholder="TV Salon, iPad"
                    onChange={(e) => update((d) => { d.filter.devices = e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </label>
              )}
            </div>

            <h2>Steps</h2>
            {draft.steps.map((step, index) => (
              <StepRow
                key={index}
                step={step}
                index={index}
                count={draft.steps.length}
                events={stepEvents}
                actions={stepActions}
                onChange={(s) => update((d) => { d.steps[index] = { ...s, id: s.id || slug(s.label) } })}
                onMove={(delta) => update((d) => {
                  const [moved] = d.steps.splice(index, 1)
                  d.steps.splice(index + delta, 0, moved!)
                })}
                onRemove={() => update((d) => { d.steps.splice(index, 1) })}
              />
            ))}
            {draft.steps.length < 6 && (
              <button
                type="button"
                className="button secondary"
                onClick={() => update((d) => {
                  const unused = stepEvents.find((e) => !d.steps.some((s) => s.on === e.type)) ?? stepEvents[0]!
                  d.steps.push({ id: `step-${d.steps.length + 1}`, label: "New step", icon: "sparkles", on: unused.type, show: {} })
                })}
              >
                Add a step
              </button>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              The activity starts at the first step that happens.
            </p>

            <h2>End</h2>
            <div className="form">
              <label className="field">
                <span>Ends when</span>
                <select value={draft.endOn ?? ""} onChange={(e) => update((d) => {
                  if (e.target.value === "") delete d.endOn
                  else d.endOn = e.target.value as FlowStep["on"]
                })}>
                  <option value="">The last step is reached</option>
                  {stepEvents.filter((e) => !draft.steps.some((s) => s.on === e.type)).map((e) => <option key={e.type} value={e.type}>{e.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Stay on screen after the last step</span>
                <select value={draft.lingerMinutes} onChange={(e) => update((d) => { d.lingerMinutes = Number(e.target.value) })}>
                  {[0, 1, 5, 15, 30, 60].map((m) => <option key={m} value={m}>{m === 0 ? "No" : `${m} min`}</option>)}
                </select>
              </label>
              {draft.subject === "media" && (
                <label className="field">
                  <span>Grey with no progress for</span>
                  <select value={draft.stalledAfterMinutes ?? 0} onChange={(e) => update((d) => {
                    const v = Number(e.target.value)
                    if (v === 0) delete d.stalledAfterMinutes
                    else d.stalledAfterMinutes = v
                  })}>
                    {[0, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m === 0 ? "Never" : `${m / 60 >= 1 ? `${m / 60} h` : `${m} min`}`}</option>)}
                  </select>
                </label>
              )}
              <label className="field">
                <span>End with no news for</span>
                <select value={draft.expireAfterMinutes ?? 0} onChange={(e) => update((d) => {
                  const v = Number(e.target.value)
                  if (v === 0) delete d.expireAfterMinutes
                  else d.expireAfterMinutes = v
                })}>
                  {[0, 15, 60, 240, 1440].map((m) => <option key={m} value={m}>{m === 0 ? "Never" : m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="button" onClick={save}>{isNew ? "Create the flow" : "Save"}</button>
              {!isNew && <button type="button" className="button secondary" onClick={test}>Test on the iPhones</button>}
              {!isNew && <button type="button" className="button secondary" onClick={duplicate}>Duplicate</button>}
              {!isNew && <button type="button" className="button danger" onClick={remove}>{draft.builtIn ? "Reset" : "Delete"}</button>}
              {isNew && <button type="button" className="button secondary" onClick={() => load()}>Cancel</button>}
            </div>
            {message && <p role={message.ok ? "status" : "alert"} style={{ margin: 0, color: message.ok ? "var(--ok)" : "var(--danger)" }}>{message.text}</p>}
          </div>
        )}
      </div>
    </>
  )
}
