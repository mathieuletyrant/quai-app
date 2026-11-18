import { type ButtonHTMLAttributes, type ReactNode, useEffect } from "react"

/** The console's building blocks: every page composes these, so the look lives in one place. */

const join = (...classes: ReadonlyArray<string | false | null | undefined>) => classes.filter(Boolean).join(" ")

const buttonVariants = {
  primary: "bg-accent text-on-accent hover:brightness-110",
  secondary: "bg-raised text-text hover:bg-white/12",
  ghost: "text-muted hover:bg-white/8 hover:text-text",
  danger: "text-danger ring-1 ring-danger/40 ring-inset hover:bg-danger/10"
} as const

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants
  size?: "sm" | "md"
}) {
  return (
    <button
      type="button"
      {...props}
      className={join(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-default disabled:opacity-40",
        size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-[13px]",
        buttonVariants[variant],
        className
      )}
    />
  )
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={join(
        "grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/8 hover:text-text disabled:pointer-events-none disabled:opacity-25",
        className
      )}
    />
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

export function Card({ title, description, actions, className, children }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={join("flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[17px] font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn"; children: ReactNode }) {
  const tones = { neutral: "bg-white/8 text-[#d1d1d6]", ok: "bg-ok/15 text-ok", warn: "bg-[#ffc230]/15 text-[#ffc230]" }
  return <span className={join("inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap", tones[tone])}>{children}</span>
}

export function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={join("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputClass =
  "h-10 w-full min-w-0 rounded-xl border border-white/12 bg-field px-3 text-sm text-text outline-none transition placeholder:text-white/30 focus:border-accent"

/** An on/off switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={join("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-ok" : "bg-white/15")}
    >
      <span className={join("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  )
}

/** A pill that toggles one option on or off. */
export function Chip({ pressed, onClick, color, children }: { pressed: boolean; onClick: () => void; color?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={pressed && color ? { borderColor: color, color } : undefined}
      className={join(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition",
        pressed ? "border-accent bg-white/6 text-accent" : "border-white/12 text-muted hover:border-white/25 hover:text-text"
      )}
    >
      {pressed && <span aria-hidden="true">✓</span>}
      {children}
    </button>
  )
}

/** One choice among a few, shown side by side. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-field p-1 ring-1 ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={join(
            "h-8 rounded-lg px-3 text-[13px] font-semibold transition",
            value === o.value ? "bg-raised text-text shadow" : "text-muted hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface Notice {
  readonly ok: boolean
  readonly text: string
}

export const errorText = (e: unknown) => typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e)

/** A short-lived message in the corner; errors stay until dismissed. */
export function Toast({ notice, onDone }: { notice: Notice | null; onDone: () => void }) {
  useEffect(() => {
    if (notice === null || !notice.ok) return
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [notice, onDone])
  if (notice === null) return null
  return (
    <div
      role={notice.ok ? "status" : "alert"}
      className={join(
        "fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-2xl border bg-raised px-4 py-3 text-sm shadow-2xl",
        notice.ok ? "border-ok/40" : "border-danger/50"
      )}
    >
      <span className={notice.ok ? "text-ok" : "text-danger"} aria-hidden="true">{notice.ok ? "●" : "▲"}</span>
      <p className="flex-1">{notice.text}</p>
      <button type="button" className="text-muted hover:text-text" aria-label="Dismiss" onClick={onDone}>✕</button>
    </div>
  )
}
