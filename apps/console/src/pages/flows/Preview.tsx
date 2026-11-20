import { useState } from "react"
import { InspectorSection, Segmented } from "../../ui.tsx"
import { actionGlyph, type Draft, endsAtLastStep } from "./draft.ts"
import { Glyph } from "./icons.tsx"

const doneColor = "#30D158"

/** Sample values, so each step shows what the iPhone would. */
const sample = {
  media: { title: "Big Buck Bunny", detail: null },
  playback: { title: "Big Buck Bunny", detail: "TV Salon" },
  service: { title: "Radarr", detail: null },
  request: { title: "Big Buck Bunny", detail: "Julie · Movie · 2008" },
  day: { title: "Tonight", detail: "1 of 3 here" }
} as const

/** Sample lines of a step showing a list. */
const sampleItems = [
  { title: "Severance S02E10", time: "20:00", done: true },
  { title: "The Bear S04E02", time: "21:00", done: false },
  { title: "Big Buck Bunny", time: null, done: false }
] as const

/**
 * The Lock Screen and Dynamic Island as the iPhone draws this flow at one step, with sample values.
 * The app draws the real thing from the same description. Playback flows can be previewed paused:
 * the step stays, says Paused, holds its bar and offers Play.
 */
export function Preview({ flow, step, onStep }: { flow: Draft; step: number; onStep: (index: number) => void }) {
  const [paused, setPaused] = useState(false)
  const current = flow.steps[step]
  if (current === undefined) return null
  const canPause = flow.subject === "playback"
  const isPaused = canPause && paused
  const done = endsAtLastStep(flow) && flow.steps.length > 1 && step === flow.steps.length - 1
  const tint = done ? doneColor : flow.color
  const { show } = current
  const { title, detail } = sample[flow.subject]
  const value = show.timer ? "38:12" : show.progress ? "63%" : show.since ? "7 min" : null
  // As the iPhone writes it: status, time left, speed, then the detail (the Jellyfin device).
  const facts = [
    isPaused ? "Paused" : current.label,
    show.eta ? "≈ 4 min" : null,
    show.speed ? "11 MB/s" : null,
    detail
  ].filter(Boolean)

  return (
    <InspectorSection
      title="Lock Screen preview"
      actions={canPause && (
        <Segmented
          label="Preview the activity"
          value={isPaused ? "paused" : "playing"}
          options={[
            { value: "playing", label: <><Glyph name="play.fill" color="currentColor" size={10} />Playing</> },
            { value: "paused", label: <><Glyph name="pause.fill" color="currentColor" size={10} />Paused</> }
          ]}
          onChange={(v) => setPaused(v === "paused")}
        />
      )}
    >
      <div
        aria-label="Lock Screen preview"
        className="relative overflow-hidden rounded-[28px] border border-line px-4 pt-4 pb-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
        style={{ background: `radial-gradient(120% 90% at 15% 0%, ${flow.color}38 0%, #15151c 52%, #09090b 100%)` }}
      >
        {/* Dynamic Island, compact */}
        <div className="mx-auto flex h-8 w-44 items-center justify-between rounded-full bg-black px-2.5">
          <Glyph name={current.icon} color={tint} size={15} />
          {isPaused ? <Glyph name="pause.fill" color={tint} size={13} /> : value && <span className="text-xs font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
        </div>
        <p className="mt-3 text-center text-5xl font-bold tracking-tight text-white/90">9:41</p>

        <div className="mt-4 flex flex-col gap-3 rounded-3xl bg-black/70 p-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black">
              <Glyph name={current.icon} color={tint} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{title}</p>
              <p className="text-[13px] leading-snug text-white/60">{facts.join(" · ")}</p>
            </div>
            {isPaused
              ? <span aria-label="Paused" className="grid size-7 place-items-center rounded-full" style={{ background: tint }}><Glyph name="pause.fill" color="#000" size={13} /></span>
              : value && <span className="text-xl font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
          </div>
          {(show.progress || show.timer) && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full" style={{ width: show.timer ? "34%" : "63%", background: tint }} />
            </div>
          )}
          {show.list && (
            <ul className="flex flex-col gap-1.5">
              {sampleItems.map((item, i) => {
                const here = item.done || done || (i === 1 && step > 0)
                return (
                  <li key={item.title} className="flex items-center gap-2 text-[13px]">
                    <Glyph name={here ? "checkmark" : "clock.fill"} color={here ? doneColor : "rgba(255,255,255,0.45)"} size={13} />
                    <span className={`min-w-0 flex-1 truncate ${here ? "text-white/60" : "text-white/90"}`}>{item.title}</span>
                    {item.time && <span className="tabular-nums text-white/50">{item.time}</span>}
                  </li>
                )
              })}
            </ul>
          )}
          {(current.actions ?? []).length > 0 && (
            <div className="flex gap-2">
              {(current.actions ?? []).map((a) => (
                <span key={a} className="grid h-9 flex-1 place-items-center rounded-xl bg-white/10">
                  <Glyph name={actionGlyph(a, isPaused)} color={tint} size={16} />
                </span>
              ))}
            </div>
          )}
          {flow.steps.length > 1 && (
            <div className="flex gap-1.5">
              {flow.steps.map((s, i) => (
                <div key={s.id} className="min-w-0 flex-1">
                  <div className="mb-1 h-[3px] rounded-full" style={{ background: i <= step ? tint : "rgba(255,255,255,0.14)" }} />
                  <p className={`truncate text-[11px] ${i === step ? "font-semibold text-white/95" : "text-white/45"}`}>{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {flow.steps.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-medium text-muted">Step</span>
          <input
            type="range"
            aria-label="Preview step"
            min={0}
            max={flow.steps.length - 1}
            value={step}
            onChange={(e) => onStep(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-[12px] tabular-nums text-muted">{step + 1} / {flow.steps.length}</span>
        </div>
      )}
    </InspectorSection>
  )
}
