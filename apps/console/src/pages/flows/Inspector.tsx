import { type CatalogAction, type CatalogEvent, stepShows } from "@quai/api"
import type { ReactNode } from "react"
import { Chip, Field, IconButton, inputClass, Segmented } from "../../ui.tsx"
import { type Draft, type DraftStep, eventName, type EventType, palette, serviceNames, showLabels, skippedFor } from "./draft.ts"
import { IconPicker } from "./IconPicker.tsx"

const minutes = (m: number) => m === 0 ? "Never" : m < 60 ? `${m} min` : `${m / 60} h`

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[13px] font-bold tracking-wide text-muted uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** The flow's look and which activities it follows. */
export function FlowPanel({ flow, onChange }: { flow: Draft; onChange: (change: (d: Draft) => void) => void }) {
  return (
    <Section title="Flow">
      <Field label="Color">
        <div className="flex flex-wrap gap-2.5">
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={flow.color === c}
              onClick={() => onChange((d) => { d.color = c })}
              className="size-7 rounded-full ring-offset-2 ring-offset-panel transition aria-pressed:ring-2 aria-pressed:ring-white"
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-muted">Icon</span>
        <IconPicker label="Flow icon" value={flow.icon} color={flow.color} onChange={(icon) => onChange((d) => { d.icon = icon })} />
      </div>
      {flow.subject === "media" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted">Titles</span>
          <Segmented
            label="Titles"
            value={flow.filter.mediaType ?? "any"}
            options={[{ value: "any", label: "All" }, { value: "movie", label: "Movies" }, { value: "series", label: "Series" }]}
            onChange={(v) => onChange((d) => { d.filter.mediaType = v })}
          />
        </div>
      )}
      {flow.subject === "playback" && (
        <Field label="Jellyfin devices" hint="Comma-separated, as Jellyfin names them. Empty: every device.">
          <input
            className={inputClass}
            value={(flow.filter.devices ?? []).join(", ")}
            placeholder="TV Salon, iPad"
            onChange={(e) => onChange((d) => { d.filter.devices = e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
      )}
    </Section>
  )
}

/** One step: its name and icon, the event that enters it, what it shows, its buttons. */
export function StepPanel(props: {
  flow: Draft
  index: number
  events: ReadonlyArray<CatalogEvent>
  actions: ReadonlyArray<CatalogAction>
  onChange: (step: DraftStep) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { flow, index, events } = props
  const step = flow.steps[index]!
  const usedBy = (type: EventType) => flow.steps.findIndex((s, i) => i !== index && s.on === type)
  const clash = usedBy(step.on)
  const skipped = skippedFor(flow, events.find((e) => e.type === step.on))
  const toggleAction = (type: CatalogAction["type"]) => {
    const actions = step.actions ?? []
    props.onChange({ ...step, actions: actions.includes(type) ? actions.filter((a) => a !== type) : [...actions, type] })
  }

  return (
    <Section
      title={`Step ${index + 1}`}
      actions={
        <>
          <IconButton label="Move up" disabled={index === 0} onClick={() => props.onMove(-1)}>↑</IconButton>
          <IconButton label="Move down" disabled={index === flow.steps.length - 1} onClick={() => props.onMove(1)}>↓</IconButton>
          <IconButton label="Remove step" disabled={flow.steps.length <= 1} onClick={props.onRemove} className="hover:text-danger">✕</IconButton>
        </>
      }
    >
      <Field label="Name">
        <input className={`${inputClass} font-semibold`} value={step.label} maxLength={24} onChange={(e) => props.onChange({ ...step, label: e.target.value })} />
      </Field>
      <Field label="Starts when">
        <select className={`${inputClass} ${clash >= 0 ? "border-danger" : ""}`} value={step.on} onChange={(e) => props.onChange({ ...step, on: e.target.value as EventType })}>
          {events.map((e) => {
            const other = usedBy(e.type)
            return <option key={e.type} value={e.type}>{eventName(e)} — {e.services.map((s) => serviceNames[s]).join(", ")}{other >= 0 ? ` (step ${other + 1})` : ""}</option>
          })}
        </select>
      </Field>
      {clash >= 0 && <p className="-mt-2 text-[13px] text-danger">Step {clash + 1} already starts on this event.</p>}
      {skipped && <p className="-mt-2 text-[13px] text-[#ffc230]">{skipped}</p>}
      {stepShows[flow.subject].length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted">Shows</span>
          <div className="flex flex-wrap gap-2">
            {stepShows[flow.subject].map((key) => (
              <Chip key={key} pressed={step.show[key] === true} color={flow.color} onClick={() => props.onChange({ ...step, show: { ...step.show, [key]: !step.show[key] } })}>
                {showLabels[key]}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {flow.subject === "playback" && (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-[13px] text-muted">
          A pause, from Jellyfin or the button, keeps this step: it says Paused, holds the bar and the button turns to Play.
          Preview it with Paused above.
        </p>
      )}
      {props.actions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-muted">Buttons</span>
          <div className="flex flex-wrap gap-2">
            {props.actions.map((a) => (
              <Chip key={a.type} pressed={(step.actions ?? []).includes(a.type)} color={flow.color} onClick={() => toggleAction(a.type)}>{a.label}</Chip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-muted">Icon</span>
        <IconPicker label="Step icon" value={step.icon} color={flow.color} onChange={(icon) => props.onChange({ ...step, icon })} />
      </div>
    </Section>
  )
}

/** How the activity ends and how long it stays. */
export function EndPanel({ flow, events, onChange }: { flow: Draft; events: ReadonlyArray<CatalogEvent>; onChange: (change: (d: Draft) => void) => void }) {
  const optional = (key: "stalledAfterMinutes" | "expireAfterMinutes") => (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange((d) => {
      const v = Number(e.target.value)
      if (v === 0) delete d[key]
      else d[key] = v
    })
  return (
    <Section title="Ends">
      <Field label="Ends when">
        <select className={inputClass} value={flow.endOn ?? ""} onChange={(e) => onChange((d) => {
          if (e.target.value === "") delete d.endOn
          else d.endOn = e.target.value as EventType
        })}>
          <option value="">The last step is reached</option>
          {events.filter((e) => !flow.steps.some((s) => s.on === e.type)).map((e) => <option key={e.type} value={e.type}>{eventName(e)} — {e.services.map((s) => serviceNames[s]).join(", ")}</option>)}
        </select>
      </Field>
      <Field label="Stays on screen after the end">
        <select className={inputClass} value={flow.lingerMinutes} onChange={(e) => onChange((d) => { d.lingerMinutes = Number(e.target.value) })}>
          {[0, 1, 5, 15, 30, 60].map((m) => <option key={m} value={m}>{m === 0 ? "No" : `${m} min`}</option>)}
        </select>
      </Field>
      {flow.subject === "media" && (
        <Field label="Turns grey with no progress for">
          <select className={inputClass} value={flow.stalledAfterMinutes ?? 0} onChange={optional("stalledAfterMinutes")}>
            {[0, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{minutes(m)}</option>)}
          </select>
        </Field>
      )}
      <Field label="Ends anyway with no news for">
        <select className={inputClass} value={flow.expireAfterMinutes ?? 0} onChange={optional("expireAfterMinutes")}>
          {[0, 15, 60, 240, 1440].map((m) => <option key={m} value={m}>{minutes(m)}</option>)}
        </select>
      </Field>
    </Section>
  )
}
