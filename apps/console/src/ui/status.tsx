import type { ReactNode } from "react"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"

const tones = {
  neutral: { badge: "bg-white/7 text-text-2", dot: "bg-faint", text: "text-muted" },
  accent: { badge: "bg-accent-soft text-accent-soft-text", dot: "bg-accent", text: "text-accent" },
  ok: { badge: "bg-ok-soft text-ok", dot: "bg-ok", text: "text-ok" },
  warn: { badge: "bg-warn-soft text-warn-text", dot: "bg-warn", text: "text-warn" },
  danger: { badge: "bg-danger-soft text-danger-text", dot: "bg-danger", text: "text-danger-text" },
  info: { badge: "bg-info-soft text-info-text", dot: "bg-info-text", text: "text-info-text" }
} as const
export type Tone = keyof typeof tones

export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-caption font-semibold whitespace-nowrap", tones[tone].badge)}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </span>
  )
}

/** A coloured dot. With a `label`, it stands alone and says what it means to screen readers. */
export function StatusDot({ tone, pulse, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  const meaning = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label, title: label }
  return (
    <span className="relative inline-flex size-2 shrink-0" {...meaning}>
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", tones[tone].dot)} />}
      <span className={cx("relative size-2 rounded-full", tones[tone].dot)} />
    </span>
  )
}

/** A status in words, coloured: "● Configured". */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-2 font-semibold", tones[tone].text)}><StatusDot tone={tone} />{children}</span>
}

/** A glyph on a dark rounded square: what a row is about, when it has no picture. */
export function IconTile({ icon, className }: { icon: IconName; className?: string }) {
  return (
    <span className={cx("grid size-9 shrink-0 place-items-center rounded-tile bg-bg", className)}>
      <Icon name={icon} size={18} strokeWidth={2.1} />
    </span>
  )
}
