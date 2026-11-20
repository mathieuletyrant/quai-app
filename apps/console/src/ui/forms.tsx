import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react"
import { cx } from "./cx.ts"
import { Icon } from "./icons.tsx"

export function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <span className="text-caption leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

/** The label above a control that isn't a single input (chips, a picker). */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-caption font-medium text-muted">{children}</span>
}

/** A labelled group of controls that isn't a single input: chips, a picker, a segmented choice. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  )
}

/** A short message under a field: what's wrong with it, or what it implies. */
export function FieldNote({ tone, children }: { tone: "danger" | "warn"; children: ReactNode }) {
  return <p className={cx("-mt-2 text-caption", tone === "danger" ? "text-danger-text" : "text-warn-text")}>{children}</p>
}

const fieldClass =
  "h-9 w-full min-w-0 rounded-control border bg-field px-3 text-body text-text outline-none transition-colors placeholder:text-faint hover:border-white/20 focus:border-accent focus-visible:outline-none"

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cx(fieldClass, invalid ? "border-danger" : "border-line-strong", className)} />
}

export function Select({ invalid, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <span className="relative block min-w-0">
      <select {...props} aria-invalid={invalid || undefined} className={cx(fieldClass, "appearance-none truncate pr-9", invalid ? "border-danger" : "border-line-strong", className)} />
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </span>
  )
}

/** An on/off switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-white/16 hover:bg-white/22")}
    >
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all", checked ? "left-4.5" : "left-0.5")} />
    </button>
  )
}

/** A chip pressed in a flow's own colour, which only the flow knows. */
const tinted = (color: string) => ({ borderColor: `${color}99`, color, background: `${color}14` })

/** A pill that toggles one option on or off. */
export function Chip({ pressed, onClick, color, children }: { pressed: boolean; onClick: () => void; color?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={pressed && color ? tinted(color) : undefined}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-small font-semibold transition-colors",
        pressed ? "border-accent/60 bg-accent/8 text-accent" : "border-line-strong text-muted hover:border-white/25 hover:text-text"
      )}
    >
      {pressed && <Icon name="check" size={13} strokeWidth={2.4} />}
      {children}
    </button>
  )
}

/** One choice among a few, shown side by side. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit flex-wrap gap-0.5 rounded-control border border-line-strong bg-field p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-item px-2.5 text-small font-semibold transition-colors",
            value === o.value ? "bg-hover text-text shadow-sm" : "text-muted hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
