import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react"
import { cx } from "./cx.ts"

/** Keeps the CSS variable `name` on the root at the element's height, as it wraps and changes. */
const useHeightVar = (ref: RefObject<HTMLElement | null>, name: string) => {
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const root = document.documentElement.style
    const update = () => root.setProperty(name, `${element.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.removeProperty(name)
    }
  }, [ref, name])
}

/** The bar at the top of every page: its title on the left, its actions on the right. Sticks under the phone top bar. */
export function PageBar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useHeightVar(ref, "--page-bar-height")
  return (
    <header ref={ref} className="sticky top-(--top-bar-height) z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-8">
        <div className="min-w-[min(100%,13rem)] flex-1">
          {typeof title === "string" ? <h1 className="text-page leading-7 font-semibold tracking-title">{title}</h1> : title}
          {subtitle && <p className="mt-0.5 truncate text-body text-muted">{subtitle}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  )
}

/** A page's content, under its bar. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex w-full max-w-280 flex-col gap-6 px-4 py-6 md:px-8 md:py-8", className)}>{children}</div>
}

/** A surface on the page, with an optional header. */
export function Panel({ title, description, actions, tone, flush, className, children }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tone?: "danger"
  /** No padding around the content: tables and lists that draw their own. */
  flush?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-panel border bg-panel", tone === "danger" ? "border-danger/30" : "border-line", className)}>
      {(title || actions) && (
        <header className={cx("flex flex-wrap items-start gap-x-4 gap-y-2 px-5 pt-5", flush ? "pb-4" : "pb-1")}>
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-title font-semibold tracking-heading">{title}</h2>}
            {description && <p className="mt-1 text-body leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(flush ? "" : "px-5 pt-3 pb-5", "min-w-0")}>{children}</div>
    </section>
  )
}

/** The style of every small uppercase heading. */
export const overline = "text-overline font-semibold tracking-caps text-faint uppercase"

/** A small uppercase heading inside a panel or an inspector. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(overline, className)}>{children}</p>
}

/** Label-value rows, one per line, separated by hairlines. */
export function Rows({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-line">{children}</dl>
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-body text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-body text-text">{children}</dd>
    </div>
  )
}

/** Monospace text: identifiers, addresses, environment variables. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-small text-text-2", className)}>{children}</span>
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-caption text-text-2">{children}</code>
}

/** A builder's work area, on a faint dot grid, next to its inspector. */
export function Workspace({ canvas, inspector }: { canvas: ReactNode; inspector: ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 bg-canvas bg-dots px-4 py-8 md:px-10 md:py-10">
        {canvas}
      </div>
      <aside className="flex flex-col border-t border-line bg-panel lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l">
        {inspector}
      </aside>
    </div>
  )
}

/** One part of an inspector: a heading with its tools, then its controls. */
export function InspectorSection({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b border-line px-5 py-5 last:border-b-0">
      <div className="-my-1 flex min-h-8 items-center gap-1">
        <h3 className={cx("flex-1", overline)}>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** A page with nothing but one card in the middle: the sign-in, and the locked console. */
export function CenteredCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-panel border border-line bg-panel p-6 shadow-sm">
        <h1 className="text-heading font-semibold tracking-heading">{title}</h1>
        {children}
      </section>
    </main>
  )
}
