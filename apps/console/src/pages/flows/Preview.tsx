import type { Draft } from "./draft.ts"
import { Glyph } from "./icons.tsx"

const doneColor = "#30D158"
const actionGlyphs: Record<string, string> = { "playback.playPause": "pause.fill", "playback.stop": "stop.fill" }

/** Sample values, so each step shows what the iPhone would. */
const sample = {
  media: { title: "Big Buck Bunny", detail: null },
  playback: { title: "Big Buck Bunny", detail: "TV Salon" },
  service: { title: "Radarr", detail: null }
} as const

/**
 * The Lock Screen and Dynamic Island as the iPhone draws this flow at one step, with sample values.
 * The app draws the real thing from the same description.
 */
export function Preview({ flow, step, onStep }: { flow: Draft; step: number; onStep: (index: number) => void }) {
  const current = flow.steps[step]
  if (current === undefined) return null
  const done = flow.endOn === undefined && flow.steps.length > 1 && step === flow.steps.length - 1
  const tint = done ? doneColor : flow.color
  const { show } = current
  const { title, detail } = sample[flow.subject]
  const value = show.timer ? "38:12" : show.progress ? "63%" : show.since ? "7 min" : null
  const facts = [
    detail,
    current.label,
    show.eta ? "≈ 4 min" : null,
    show.speed ? "11 MB/s" : null,
    show.timer ? "ends 22:41" : null,
    show.since ? "down for 7 min" : null
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-label="Lock Screen preview"
        className="relative overflow-hidden rounded-[28px] border border-line bg-[radial-gradient(120%_90%_at_20%_0%,#3a2f5c_0%,#141420_55%,#0b0b0f_100%)] px-4 pt-4 pb-5"
      >
        {/* Dynamic Island, compact */}
        <div className="mx-auto flex h-8 w-44 items-center justify-between rounded-full bg-black px-2.5">
          <Glyph name={current.icon} color={tint} size={15} />
          {value && <span className="text-xs font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
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
            {value && <span className="text-xl font-bold tabular-nums" style={{ color: tint }}>{value}</span>}
          </div>
          {(show.progress || show.timer) && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full" style={{ width: show.timer ? "34%" : "63%", background: tint }} />
            </div>
          )}
          {(current.actions ?? []).length > 0 && (
            <div className="flex gap-2">
              {(current.actions ?? []).map((a) => (
                <span key={a} className="grid h-9 flex-1 place-items-center rounded-xl bg-white/10">
                  <Glyph name={actionGlyphs[a] ?? "sparkles"} color={tint} size={16} />
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
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted">Preview step</span>
          <input
            type="range"
            aria-label="Preview step"
            min={0}
            max={flow.steps.length - 1}
            value={step}
            onChange={(e) => onStep(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-[13px] tabular-nums text-muted">{step + 1}/{flow.steps.length}</span>
        </div>
      )}
    </div>
  )
}
