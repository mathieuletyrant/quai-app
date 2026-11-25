import { type ReactNode, useEffect } from "react"
import { isCloudOffline } from "../client.ts"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"

export const errorText = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)

const calloutTones = {
  neutral: "border-line bg-white/3 text-muted",
  warn: "border-warn/25 bg-warn-soft/60 text-warn-text",
  danger: "border-danger/30 bg-danger-soft/60 text-danger-text"
} as const

/** A message across a panel or the page: what's wrong, and what to do. */
export function Callout({ tone = "neutral", icon, title, children, action }: {
  tone?: keyof typeof calloutTones
  icon?: IconName
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx("flex flex-wrap items-start gap-3 rounded-card border px-4 py-3 text-body", calloutTones[tone])}
    >
      {icon && <Icon name={icon} size={16} className="mt-0.5" />}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold text-text">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

/**
 * A call that failed, as a danger callout; nothing without an error. With `unlessOffline`, an
 * unreachable Quai Cloud isn't shown either: the page says so in place of what it couldn't read.
 */
export function ErrorCallout(
  { error, title, unlessOffline }: { error: unknown; title?: ReactNode; unlessOffline?: boolean }
) {
  if (error === null || error === undefined || (unlessOffline && isCloudOffline(error))) return null
  return <Callout tone="danger" icon="alert" title={title}>{errorText(error)}</Callout>
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-shimmer rounded-md bg-white/7", className)} />
}

/** A list's outline while it loads: `count` bars inside a flush panel. */
export function SkeletonList({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
    </div>
  )
}

/** What a panel shows with nothing in it: what's missing, and the action that fills it. */
export function EmptyState({ icon, title, children, action, compact }: {
  icon: IconName
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 text-center", compact ? "py-10" : "py-16")}>
      <span className="grid size-11 place-items-center rounded-card bg-raised text-muted ring-1 ring-line-strong">
        <Icon name={icon} size={20} />
      </span>
      <p className="mt-4 text-title font-semibold">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-body leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** In place of what a page couldn't read because Quai Home isn't linked to Quai Cloud. */
export function CloudOfflineState({ what }: { what: string }) {
  return (
    <EmptyState icon="unlink" title="Quai Cloud isn't reachable">
      {what}{" "}
      are kept at home, but read and changed through Quai Cloud. They come back here as soon as Quai Home links to it.
    </EmptyState>
  )
}

export interface Notice {
  readonly ok: boolean
  readonly text: string
}

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
      className="fixed right-4 bottom-4 left-4 z-50 flex animate-pop items-start gap-3 rounded-card bg-raised px-4 py-3 text-body shadow-pop sm:left-auto sm:max-w-sm"
    >
      <span
        className={cx(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
          notice.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger-text"
        )}
      >
        <Icon name={notice.ok ? "check" : "alert"} size={12} strokeWidth={2.4} />
      </span>
      <p className="flex-1 leading-relaxed">{notice.text}</p>
      <button
        type="button"
        className="-m-1 grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/8 hover:text-text"
        aria-label="Dismiss"
        onClick={onDone}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
