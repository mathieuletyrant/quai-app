import type { ReactNode } from "react"
import { cx } from "./cx.ts"

/** Items one under the other, separated by hairlines, inside a flush panel. */
export function ItemList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>
}

/**
 * One item: what it is on the left, a detail and its state in the middle, its action on the right;
 * stacked on phones. `children`, when given, opens below it (a form, say).
 */
export function Item({ title, subtitle, detail, state, action, open, children }: {
  title: ReactNode
  subtitle?: ReactNode
  detail?: ReactNode
  state?: ReactNode
  action?: ReactNode
  open?: boolean
  children?: ReactNode
}) {
  return (
    <li className={cx(open && "bg-white/2")}>
      <div className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem] md:items-center">
        <div className="min-w-0">
          <p className="text-item font-semibold">{title}</p>
          {subtitle && <p className="mt-0.5 text-caption text-muted">{subtitle}</p>}
        </div>
        {detail ? <div className="min-w-0 truncate text-body">{detail}</div> : <div className="hidden md:block" />}
        <div className="min-w-0 text-body">{state}</div>
        <div className="flex justify-start md:justify-end">{action}</div>
      </div>
      {children && <div className="border-t border-line px-5 py-5">{children}</div>}
    </li>
  )
}
