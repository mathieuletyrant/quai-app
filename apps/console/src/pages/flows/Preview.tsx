import { useState } from "react"
import { InspectorSection, Segmented } from "../../ui"
import { actionGlyph, type Draft, type DraftStep, endsAtLastStep } from "./draft.ts"
import { Glyph } from "./icons.tsx"

/** The tint of a finished activity, as the iPhone draws it. */
const doneColor = "var(--color-ok)"
const pendingColor = "rgba(255,255,255,0.45)"
const trackColor = "rgba(255,255,255,0.14)"

/** Sample values, so each step shows what the iPhone would. */
const sample = {
  media: { title: "Big Buck Bunny", detail: null },
  playback: { title: "Big Buck Bunny", detail: "TV Salon" },
  service: { title: "Radarr", detail: null },
  request: { title: "Big Buck Bunny", detail: "Julie · Movie · 2008" },
  day: { title: "Today", detail: "1 of 3 here" }
} as const

/** Sample lines of a step showing a list. */
const sampleItems = [
  { title: "Severance S02E10", time: "20:00", done: true },
  { title: "The Bear S04E02", time: "21:00", done: false },
  { title: "Big Buck Bunny", time: null, done: false }
] as const

/** The big number on the right: a countdown, a progress or the time since. */
const sampleValue = (show: DraftStep["show"]) => show.timer ? "38:12" : show.progress ? "63%" : show.since ? "7 min" : null

/** As the iPhone writes it: status, time left, speed, then the detail (the Jellyfin device). */
const sampleFacts = (step: DraftStep, paused: boolean, detail: string | null) =>
  [paused ? "Paused" : step.label, step.show.eta ? "≈ 4 min" : null, step.show.speed ? "11 MB/s" : null, detail].filter(Boolean).join(" · ")

/** The wallpaper: the flow's colour fading into the page. */
const wallpaper = (color: string) => `radial-gradient(120% 90% at 15% 0%, ${color}38 0%, var(--color-wallpaper) 52%, var(--color-bg) 100%)`

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
  const value = sampleValue(current.show)
  const { title, detail } = sample[flow.subject]
  const actions = current.actions ?? []

  return (
    <InspectorSection title="Lock Screen preview" actions={canPause && <PauseSwitch paused={isPaused} onChange={setPaused} />}>
      <div
        aria-label="Lock Screen preview"
        className="relative overflow-hidden rounded-phone border border-line px-4 pt-4 pb-5 shadow-sheen"
        style={{ background: wallpaper(flow.color) }}
      >
        <DynamicIsland icon={current.icon} tint={tint} paused={isPaused} value={value} />
        <p className="mt-3 text-center text-5xl font-bold tracking-tight text-white/90">9:41</p>

        <div className="mt-4 flex flex-col gap-3 rounded-3xl bg-black/70 p-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black">
              <Glyph name={current.icon} color={tint} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{title}</p>
              <p className="text-body leading-snug text-white/60">{sampleFacts(current, isPaused, detail)}</p>
            </div>
            {isPaused
              ? <span aria-label="Paused" className="grid size-7 place-items-center rounded-full" style={{ background: tint }}><Glyph name="pause.fill" color="black" size={13} /></span>
              : value && <span className="text-xl font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
          </div>
          {(current.show.progress || current.show.timer) && <ProgressBar share={current.show.timer ? "34%" : "63%"} tint={tint} />}
          {current.show.list && <SampleList done={done} step={step} />}
          {actions.length > 0 && (
            <div className="flex gap-2">
              {actions.map((a) => (
                <span key={a} className="grid h-9 flex-1 place-items-center rounded-xl bg-white/10">
                  <Glyph name={actionGlyph(a, isPaused)} color={tint} size={16} />
                </span>
              ))}
            </div>
          )}
          {flow.steps.length > 1 && <StepTrack steps={flow.steps} current={step} tint={tint} />}
        </div>
      </div>

      {flow.steps.length > 1 && <StepSlider count={flow.steps.length} step={step} onStep={onStep} />}
    </InspectorSection>
  )
}

/** Playing or Paused, for a playback flow's preview. */
function PauseSwitch({ paused, onChange }: { paused: boolean; onChange: (paused: boolean) => void }) {
  return (
    <Segmented
      label="Preview the activity"
      value={paused ? "paused" : "playing"}
      options={[
        { value: "playing", label: <><Glyph name="play.fill" color="currentColor" size={10} />Playing</> },
        { value: "paused", label: <><Glyph name="pause.fill" color="currentColor" size={10} />Paused</> }
      ]}
      onChange={(v) => onChange(v === "paused")}
    />
  )
}

/** The compact Dynamic Island: the step's glyph, and its value or a pause sign. */
function DynamicIsland({ icon, tint, paused, value }: { icon: string; tint: string; paused: boolean; value: string | null }) {
  return (
    <div className="mx-auto flex h-8 w-44 items-center justify-between rounded-full bg-black px-2.5">
      <Glyph name={icon} color={tint} size={15} />
      {paused ? <Glyph name="pause.fill" color={tint} size={13} /> : value && <span className="text-xs font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
    </div>
  )
}

function ProgressBar({ share, tint }: { share: string; tint: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-full" style={{ width: share, background: tint }} />
    </div>
  )
}

/** The sample releases, ticked off as they arrive: all of them once the flow is done. */
function SampleList({ done, step }: { done: boolean; step: number }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {sampleItems.map((item, i) => {
        const here = item.done || done || (i === 1 && step > 0)
        return (
          <li key={item.title} className="flex items-center gap-2 text-body">
            <Glyph name={here ? "checkmark" : "clock.fill"} color={here ? doneColor : pendingColor} size={13} />
            <span className={`min-w-0 flex-1 truncate ${here ? "text-white/60" : "text-white/90"}`}>{item.title}</span>
            {item.time && <span className="tabular-nums text-white/50">{item.time}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** Each step's name under a bar, filled up to the current one. */
function StepTrack({ steps, current, tint }: { steps: ReadonlyArray<DraftStep>; current: number; tint: string }) {
  return (
    <div className="flex gap-1.5">
      {steps.map((s, i) => (
        <div key={s.id} className="min-w-0 flex-1">
          <div className="mb-1 h-0.75 rounded-full" style={{ background: i <= current ? tint : trackColor }} />
          <p className={`truncate text-overline ${i === current ? "font-semibold text-white/95" : "text-white/45"}`}>{s.label}</p>
        </div>
      ))}
    </div>
  )
}

/** Picks the step the preview shows. */
function StepSlider({ count, step, onStep }: { count: number; step: number; onStep: (index: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-caption font-medium text-muted">Step</span>
      <input
        type="range"
        aria-label="Preview step"
        min={0}
        max={count - 1}
        value={step}
        onChange={(e) => onStep(Number(e.target.value))}
        className="flex-1 accent-accent"
      />
      <span className="w-10 text-right text-caption tabular-nums text-muted">{step + 1} / {count}</span>
    </div>
  )
}
