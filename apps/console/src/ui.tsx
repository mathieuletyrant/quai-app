import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"

/** The console's building blocks: every page composes these, so the look lives in one place. */

export const cx = (...classes: ReadonlyArray<string | false | null | undefined>) => classes.filter(Boolean).join(" ")

// ── Icons ────────────────────────────────────────────────────────────────────────────────────────

const paths = {
  logo: "M3 15h18M6 15V9h12v6M9 9V5h6v4M4 19c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5",
  phone: "M8 2.75h8A1.75 1.75 0 0 1 17.75 4.5v15A1.75 1.75 0 0 1 16 21.25H8A1.75 1.75 0 0 1 6.25 19.5v-15A1.75 1.75 0 0 1 8 2.75zM10.5 18.25h3",
  flows: "M6 3.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM18 15.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM6 8.25v3.5a3 3 0 0 0 3 3h6M15 12l3 2.75L15 17.5",
  settings: "M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1M15 4.5v4M9 10v4M17 15.5v4",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6.5 9.5L12 15l5.5-5.5",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  play: "M8 5.5v13l10.5-6.5z",
  trash: "M4.5 6.5h15M9.5 6.5V4.75h5V6.5M6.5 6.5l.9 12.6A1.5 1.5 0 0 0 8.9 20.5h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6M10 10.5v6M14 10.5v6",
  copy: "M9 9h10.25v10.25H9zM15 9V4.75H4.75V15H9",
  reset: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.01",
  cloud: "M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.46A3.75 3.75 0 0 1 17.25 18.5z",
  home: "M4 10.5L12 4l8 6.5V20H4zM9.5 20v-5.5h5V20",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  unlink: "M9.5 6.3l1.5-1.5a4 4 0 0 1 5.66 5.66l-1.5 1.5M14.5 17.7L13 19.2a4 4 0 0 1-5.66-5.66l1.5-1.5M4 4l16 16",
  key: "M14.5 9.5a4.5 4.5 0 1 1-8.99.01 4.5 4.5 0 0 1 8.99-.01zM13.2 12.7L20 19.5M17.5 17l2-2",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h1.5M18.5 14H20",
  refresh: "M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5M17.5 3.5V7h-3.5M6.5 20.5V17H10",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  flag: "M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11",
  server: "M4 4.5h16v6H4zM4 13.5h16v6H4zM7.5 7.5h.01M7.5 16.5h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20",
  shield: "M12 3.5l7 2.5v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6zM9 12l2 2 4-4",
  download: "M12 4v11M7 10.5l5 5 5-5M5 19.5h14",
  moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"
} as const
export type IconName = keyof typeof paths

/** One stroke icon, 24-unit grid, drawn in the current text colour. */
export function Icon({ name, size = 16, strokeWidth = 1.8, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("shrink-0", className)}
    >
      <path d={paths[name]} />
    </svg>
  )
}

/** Quai's mark: the dock on its accent tile. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[9px] bg-accent text-on-accent" style={{ width: size, height: size }}>
      <Icon name="logo" size={Math.round(size * 0.6)} strokeWidth={2.4} />
    </span>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────────────────────────

const control = "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40"

const buttonVariants = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-raised text-text ring-1 ring-line-strong ring-inset hover:bg-hover",
  ghost: "text-muted hover:bg-white/6 hover:text-text",
  danger: "text-danger-text ring-1 ring-danger/35 ring-inset hover:bg-danger-soft"
} as const

export function Button({ variant = "primary", size = "md", icon, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants
  size?: "sm" | "md"
  icon?: IconName
}) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap",
        control,
        size === "md" ? "h-9 px-3.5 text-[13px]" : "h-8 px-3 text-[13px]",
        icon && (size === "md" ? "pl-3" : "pl-2.5"),
        buttonVariants[variant],
        className
      )}
    >
      {icon && <Icon name={icon} size={15} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function IconButton({ label, icon, outlined, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon?: IconName
  outlined?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-white/6 hover:text-text",
        control,
        outlined && "bg-raised ring-1 ring-line-strong ring-inset hover:bg-hover",
        className
      )}
    >
      {icon ? <Icon name={icon} size={16} /> : children}
    </button>
  )
}

// ── Page structure ───────────────────────────────────────────────────────────────────────────────

/** The bar at the top of every page: its title on the left, its actions on the right. */
export function PageBar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-8">
        <div className="min-w-[min(100%,13rem)] flex-1">
          {typeof title === "string" ? <h1 className="text-[19px] leading-7 font-semibold tracking-[-0.02em]">{title}</h1> : title}
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  )
}

/** A page's content, under its bar. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex w-full max-w-[1120px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8", className)}>{children}</div>
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
            {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>}
            {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(flush ? "" : "px-5 pt-3 pb-5", "min-w-0")}>{children}</div>
    </section>
  )
}

/** A small uppercase heading inside a panel or an inspector. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[11px] font-semibold tracking-[0.06em] text-faint uppercase", className)}>{children}</p>
}

/** Label-value rows, one per line, separated by hairlines. */
export function Rows({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-line">{children}</dl>
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-text">{children}</dd>
    </div>
  )
}

/** Monospace text: identifiers, addresses, environment variables. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12.5px] text-text-2", className)}>{children}</span>
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[12px] text-text-2">{children}</code>
}

// ── Tables ───────────────────────────────────────────────────────────────────────────────────────

export interface Column<T> {
  readonly header: ReactNode
  readonly cell: (row: T) => ReactNode
  readonly className?: string
  /** Left out of the stacked layout on phones (e.g. the row's actions, shown in its header). */
  readonly primary?: boolean
  readonly align?: "right"
}

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
  const th = "h-10 px-5 text-left text-[11px] font-semibold tracking-[0.06em] text-faint uppercase"
  const primary = columns.find((c) => c.primary) ?? columns[0]!
  const rest = columns.filter((c) => c !== primary)
  return (
    <>
      <table className="hidden w-full border-collapse text-[13px] md:table">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => <th key={i} className={cx(th, c.align === "right" && "text-right", c.className)}>{c.header}</th>)}
            {actions && <th className={th}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows === null
            ? [0, 1, 2].map((i) => (
              <tr key={i}>
                {columns.map((c, j) => <td key={j} className="h-14 px-5"><Skeleton className={j === 0 ? "h-4 w-40" : "h-4 w-20"} /></td>)}
                {actions && <td />}
              </tr>
            ))
            : rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-white/[0.025]">
                {columns.map((c, j) => <td key={j} className={cx("h-14 px-5", c.align === "right" && "text-right", c.className)}>{c.cell(row)}</td>)}
                {actions && <td className="h-14 w-px px-3 text-right whitespace-nowrap">{actions(row)}</td>}
              </tr>
            ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows === null
          ? [0, 1].map((i) => <li key={i} className="flex flex-col gap-3 p-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-56" /></li>)
          : rows.map((row) => (
            <li key={rowKey(row)} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">{primary.cell(row)}</div>
                {actions?.(row)}
              </div>
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
                {rest.map((c, j) => (
                  <div key={j} className="contents">
                    <dt className="text-muted">{c.header}</dt>
                    <dd className="justify-self-end">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
      </ul>
    </>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────────

const tones = {
  neutral: { badge: "bg-white/7 text-text-2", dot: "bg-faint" },
  accent: { badge: "bg-accent-soft text-accent-soft-text", dot: "bg-accent" },
  ok: { badge: "bg-ok-soft text-ok", dot: "bg-ok" },
  warn: { badge: "bg-warn-soft text-warn-text", dot: "bg-warn" },
  danger: { badge: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  info: { badge: "bg-info-soft text-info-text", dot: "bg-info-text" }
} as const
export type Tone = keyof typeof tones

export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold whitespace-nowrap", tones[tone].badge)}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </span>
  )
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", tones[tone].dot)} />}
      <span className={cx("relative size-2 rounded-full", tones[tone].dot)} />
    </span>
  )
}

/** A glyph on a dark rounded square: what a row is about, when it has no picture. */
export function IconTile({ icon, className }: { icon: IconName; className?: string }) {
  return (
    <span className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] bg-bg", className)}>
      <Icon name={icon} size={18} strokeWidth={2.1} />
    </span>
  )
}

/** TMDB lists the original poster (several MB): a thumbnail asks for a 185 px wide one. */
export const posterThumbnail = (url: string) => url.replace("/t/p/original/", "/t/p/w185/")

/**
 * A 2:3 poster thumbnail with a glyph badge on its corner. `fallback` shows while it loads,
 * when it fails, and when there is no poster.
 */
export function PosterThumb(props: {
  src: string | undefined
  badge?: IconName
  badgeClassName?: string
  fallback: ReactNode
}) {
  if (props.src === undefined) return <>{props.fallback}</>
  // Keyed by its URL: another poster starts over with its own load state.
  return <LoadedPoster key={props.src} {...props} src={props.src} />
}

function LoadedPoster({ src, badge, badgeClassName, fallback }: {
  src: string
  badge?: IconName
  badgeClassName?: string
  fallback: ReactNode
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading")
  if (state === "failed") return <>{fallback}</>
  return (
    <span className="relative inline-block shrink-0">
      {state === "loading" && <span className="absolute inset-0">{fallback}</span>}
      <img
        src={posterThumbnail(src)}
        alt=""
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={cx("block h-[60px] w-10 rounded-lg bg-bg object-cover", state === "loading" && "invisible")}
      />
      {badge !== undefined && state === "loaded" && (
        <span className={cx("absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full bg-bg ring-2 ring-panel", badgeClassName)}>
          <Icon name={badge} size={11} strokeWidth={2.4} />
        </span>
      )}
    </span>
  )
}

/** A status in words, coloured: "● Configured". */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const text = { neutral: "text-muted", accent: "text-accent", ok: "text-ok", warn: "text-warn", danger: "text-danger-text", info: "text-info-text" }[tone]
  return <span className={cx("inline-flex items-center gap-2 font-semibold", text)}><StatusDot tone={tone} />{children}</span>
}

/** A message across a panel or the page: what's wrong, and what to do. */
export function Callout({ tone = "neutral", icon, title, children, action }: {
  tone?: "neutral" | "warn" | "danger"
  icon?: IconName
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const styles = {
    neutral: "border-line bg-white/[0.03] text-muted",
    warn: "border-warn/25 bg-warn-soft/60 text-warn-text",
    danger: "border-danger/30 bg-danger-soft/60 text-danger-text"
  }[tone]
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cx("flex flex-wrap items-start gap-3 rounded-card border px-4 py-3 text-[13px]", styles)}>
      {icon && <Icon name={icon} size={16} className="mt-0.5" />}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold text-text">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-shimmer rounded-md bg-white/7", className)} />
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
      <p className="mt-4 text-[15px] font-semibold">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** In place of what a page couldn't read because Quai Home isn't linked. */
export function HomeOfflineState({ what }: { what: string }) {
  return (
    <EmptyState icon="unlink" title="Quai Home is offline">
      {what} live in Quai Home, at home. They come back here as soon as it reconnects to Quai Cloud.
    </EmptyState>
  )
}

// ── Form controls ────────────────────────────────────────────────────────────────────────────────

export function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <span className="text-[12px] leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

/** The label above a control that isn't a single input (chips, a picker). */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[12px] font-medium text-muted">{children}</span>
}

const fieldClass =
  "h-9 w-full min-w-0 rounded-control border bg-field px-3 text-[13px] text-text outline-none transition-colors placeholder:text-faint hover:border-white/20 focus:border-accent focus-visible:outline-none"

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
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all", checked ? "left-[18px]" : "left-0.5")} />
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
      style={pressed && color ? { borderColor: `${color}99`, color, background: `${color}14` } : undefined}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
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
            "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-semibold transition-colors",
            value === o.value ? "bg-hover text-text shadow-sm" : "text-muted hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Overlays ─────────────────────────────────────────────────────────────────────────────────────

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
      className="fixed right-4 bottom-4 left-4 z-50 flex animate-pop items-start gap-3 rounded-card bg-raised px-4 py-3 text-[13px] shadow-pop sm:left-auto sm:max-w-sm"
    >
      <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", notice.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger-text")}>
        <Icon name={notice.ok ? "check" : "alert"} size={12} strokeWidth={2.4} />
      </span>
      <p className="flex-1 leading-relaxed">{notice.text}</p>
      <button type="button" className="-m-1 grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/8 hover:text-text" aria-label="Dismiss" onClick={onDone}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}

/** A button that opens a floating panel, closed by a click outside or Escape. */
export function Popover({ trigger, align = "left", className, children }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  align?: "left" | "right"
  className?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Keeps the panel inside the viewport when its trigger sits near an edge (phones).
  useLayoutEffect(() => {
    if (!open || panel.current === null) return setShift(0)
    const rect = panel.current.getBoundingClientRect()
    const margin = 12
    setShift(rect.left < margin ? margin - rect.left : rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative min-w-0">
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          ref={panel}
          style={shift ? { translate: `${shift}px 0` } : undefined}
          className={cx(
            "absolute z-40 mt-2 flex max-h-[min(70vh,560px)] max-w-[calc(100vw-2rem)] min-w-56 animate-pop flex-col gap-px overflow-y-auto rounded-card bg-raised p-1.5 shadow-pop",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** One row of a Popover menu. */
export function MenuItem({ danger, icon, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; icon?: IconName }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/6 focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-danger-text hover:bg-danger-soft" : "text-text",
        className
      )}
    >
      {icon && <Icon name={icon} size={15} className={danger ? "" : "text-muted"} />}
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>
}

export function MenuSeparator() {
  return <span role="separator" className="mx-1 my-1 h-px bg-line" />
}

// ── Editor layout ────────────────────────────────────────────────────────────────────────────────

/** A builder's work area, on a faint dot grid, next to its inspector. */
export function Workspace({ canvas, inspector }: { canvas: ReactNode; inspector: ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 bg-canvas bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:20px_20px] px-4 py-8 md:px-10 md:py-10">
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
        <h3 className="flex-1 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}
