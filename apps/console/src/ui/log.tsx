import type { ReactNode } from "react"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"
import { overline } from "./layout.tsx"
import { StatusDot, type Tone } from "./status.tsx"

/** A dense, console-like list of lines, newest on top, in a flush panel. */
export function LogList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col pb-1 font-mono text-small">{children}</div>
}

/** The heading of one day's lines: "Today", "Yesterday", "Wed, Nov 18". */
export function LogDay({ children }: { children: ReactNode }) {
  return <p className={cx(overline, "sticky top-(--content-top) z-10 border-b border-line bg-panel/95 px-4 pt-4 pb-2 font-sans backdrop-blur md:px-5")}>{children}</p>
}

/**
 * One line: its time, a dot in its level's tone, where it comes from, what happened, and what it
 * is about (`aside`: a title chip, an iPhone). `fresh` marks a line that just came in.
 */
export function LogLine({ time, tone, source, icon, fresh, aside, children }: {
  time: string
  tone: Tone
  source: string
  icon: IconName
  fresh?: boolean
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={cx(
      "grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 last:border-b-0 hover:bg-white/2 md:grid-cols-[auto_auto_8.5rem_minmax(0,1fr)_auto] md:px-5",
      fresh && "animate-pop bg-accent/4"
    )}>
      <time className="text-faint tabular-nums">{time}</time>
      <span className="self-start pt-1"><StatusDot tone={tone} /></span>
      <span className="hidden items-center gap-1.5 truncate text-muted md:flex">
        <Icon name={icon} size={13} className="text-faint" />
        {source}
      </span>
      <p className="min-w-0 leading-relaxed text-text-2">
        <span className="mr-2 text-muted md:hidden">{source}</span>
        {children}
      </p>
      {aside && <div className="col-start-3 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">{aside}</div>}
    </div>
  )
}

/** A small pill on a line: a title to filter by, or the iPhone it went to. */
export function LogTag({ icon, onClick, title, children }: { icon: IconName; onClick?: () => void; title?: string; children: ReactNode }) {
  const look = "inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md px-2 font-sans text-caption font-semibold"
  if (onClick === undefined) {
    return <span className={cx(look, "bg-white/5 text-muted")}><Icon name={icon} size={12} /><span className="truncate">{children}</span></span>
  }
  return (
    <button type="button" title={title} onClick={onClick} className={cx(look, "bg-accent-soft text-accent-soft-text transition-colors hover:bg-accent/20")}>
      <Icon name={icon} size={12} />
      <span className="truncate">{children}</span>
    </button>
  )
}
