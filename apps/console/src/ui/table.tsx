import type { ReactNode } from "react"
import { cx } from "./cx.ts"
import { Skeleton } from "./feedback.tsx"
import { overline } from "./layout.tsx"

export interface Column<T> {
  readonly header: ReactNode
  readonly cell: (row: T) => ReactNode
  readonly className?: string
  /** Left out of the stacked layout on phones (e.g. the row's actions, shown in its header). */
  readonly primary?: boolean
  readonly align?: "right"
}

const th = cx("h-10 px-5 text-left", overline)

/**
 * Rows of records: a table on wide screens, stacked cards on phones. While `rows` is null it
 * shows skeleton rows; with none, `empty`.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, actions }: {
  columns: ReadonlyArray<Column<T>>
  rows: ReadonlyArray<T> | null
  rowKey: (row: T) => string
  empty: ReactNode
  actions?: (row: T) => ReactNode
}) {
  if (rows !== null && rows.length === 0) return <>{empty}</>
  return (
    <>
      <table className="hidden w-full border-collapse text-body md:table">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => <th key={i} className={cx(th, c.align === "right" && "text-right", c.className)}>{c.header}</th>)}
            {actions && <th className={th}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows === null
            ? [0, 1, 2].map((i) => <SkeletonRow key={i} columns={columns.length} actions={actions !== undefined} />)
            : rows.map((row) => <TableRow key={rowKey(row)} row={row} columns={columns} actions={actions} />)}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows === null
          ? [0, 1].map((i) => <li key={i} className="flex flex-col gap-3 p-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-56" /></li>)
          : rows.map((row) => <StackedRow key={rowKey(row)} row={row} columns={columns} actions={actions} />)}
      </ul>
    </>
  )
}

function SkeletonRow({ columns, actions }: { columns: number; actions: boolean }) {
  return (
    <tr>
      {Array.from({ length: columns }, (_, j) => <td key={j} className="h-14 px-5"><Skeleton className={j === 0 ? "h-4 w-40" : "h-4 w-20"} /></td>)}
      {actions && <td />}
    </tr>
  )
}

function TableRow<T>({ row, columns, actions }: { row: T; columns: ReadonlyArray<Column<T>>; actions: ((row: T) => ReactNode) | undefined }) {
  return (
    <tr className="transition-colors hover:bg-white/[0.025]">
      {columns.map((c, j) => <td key={j} className={cx("h-14 px-5", c.align === "right" && "text-right", c.className)}>{c.cell(row)}</td>)}
      {actions && <td className="h-14 w-px px-3 text-right whitespace-nowrap">{actions(row)}</td>}
    </tr>
  )
}

/** A record on a phone: its primary cell and actions on top, the other columns as label-value pairs. */
function StackedRow<T>({ row, columns, actions }: { row: T; columns: ReadonlyArray<Column<T>>; actions: ((row: T) => ReactNode) | undefined }) {
  const primary = columns.find((c) => c.primary) ?? columns[0]!
  const rest = columns.filter((c) => c !== primary)
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{primary.cell(row)}</div>
        {actions?.(row)}
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body">
        {rest.map((c, j) => (
          <div key={j} className="contents">
            <dt className="text-muted">{c.header}</dt>
            <dd className="justify-self-end">{c.cell(row)}</dd>
          </div>
        ))}
      </dl>
    </li>
  )
}
