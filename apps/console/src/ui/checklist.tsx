import type { ReactNode } from "react"
import { cx } from "./cx.ts"
import { Icon } from "./icons.tsx"

/** A short list of steps to set something up, ticked as they're done. */
export function Checklist({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-accent/30 bg-accent/5 p-5">
      <h2 className="text-title font-semibold tracking-heading">{title}</h2>
      <ol className="mt-4 flex flex-col gap-3">{children}</ol>
    </section>
  )
}

/** One step: its number or a tick, what it is, and where it's done. */
export function ChecklistItem(
  { index, done, title, href, children }: {
    index: number
    done: boolean
    title: ReactNode
    href: string
    children: ReactNode
  }
) {
  return (
    <li className="flex gap-3.5">
      <span
        className={cx(
          "grid size-7 shrink-0 place-items-center rounded-full text-caption font-bold ring-1",
          done ? "bg-ok-soft text-ok ring-ok/30" : "bg-raised text-text-2 ring-line-strong"
        )}
      >
        {done ? <Icon name="check" size={14} strokeWidth={2.4} /> : index}
      </span>
      <a href={href} className="group min-w-0 pt-0.5">
        <p className={cx("text-copy font-semibold group-hover:text-accent", done && "text-muted line-through")}>
          {title}
        </p>
        <p className="mt-0.5 text-body text-muted">{children}</p>
      </a>
    </li>
  )
}
