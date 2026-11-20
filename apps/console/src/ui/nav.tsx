import { type ReactNode, useEffect, useRef } from "react"
import { IconButton } from "./buttons.tsx"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"

/** One destination of the console. */
export interface NavItem {
  readonly id: string
  readonly label: string
  readonly icon: IconName
}

function NavLink({ item, current, onNavigate }: { item: NavItem; current: boolean; onNavigate?: (() => void) | undefined }) {
  return (
    <a
      href={`#${item.id}`}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
      className={cx(
        "group flex h-9 shrink-0 items-center gap-2.5 rounded-control px-3 text-body font-semibold transition-colors",
        current ? "bg-raised text-text ring-1 ring-line ring-inset" : "text-muted hover:bg-white/4 hover:text-text"
      )}
    >
      <Icon name={item.icon} size={17} className={current ? "text-accent" : "text-faint transition-colors group-hover:text-muted"} />
      {item.label}
    </a>
  )
}

/** The console's destinations, one per line, the current one highlighted: in the sidebar and the phone menu. */
export function NavList({ label, items, current, onNavigate }: {
  label: string
  items: ReadonlyArray<NavItem>
  current: string
  onNavigate?: (() => void) | undefined
}) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => <NavLink key={item.id} item={item} current={item.id === current} onNavigate={onNavigate} />)}
    </nav>
  )
}

/** The console's navigation on wide screens: its brand, the destinations, and what sits at the foot. */
export function Sidebar({ brand, footer, children }: { brand: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-line bg-sidebar px-3 pt-4 pb-3 md:flex">
      <div className="mb-5">{brand}</div>
      {children}
      <div className="mt-auto">{footer}</div>
    </aside>
  )
}

/** The bar at the top on phones: the button that opens the menu, the logo, where you are, and a status. */
export function TopBar({ logo, title, status, menuOpen, onMenu }: {
  logo: ReactNode
  title: string
  status: ReactNode
  menuOpen: boolean
  onMenu: () => void
}) {
  return (
    <header className="sticky top-0 z-40 flex h-top-bar items-center gap-3 border-b border-line bg-sidebar px-4 md:hidden">
      <IconButton label="Open menu" icon="menu" className="-ml-2" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu} />
      {logo}
      <p className="min-w-0 flex-1 truncate text-heading font-semibold tracking-heading">{title}</p>
      {status}
    </header>
  )
}

/** Stops the page behind from scrolling while `locked`. */
const useScrollLock = (locked: boolean) => {
  useEffect(() => {
    if (!locked) return
    const root = document.documentElement
    const before = root.style.overflow
    root.style.overflow = "hidden"
    return () => { root.style.overflow = before }
  }, [locked])
}

/**
 * A sheet from the left on phones, where the sidebar sits on wide screens, over a dimmed page. A modal `<dialog>`: the page behind is inert
 * (focus stays inside), Escape and a tap on the backdrop close it, focus goes back where it was.
 */
export function Drawer({ open, label, brand, onClose, footer, children }: {
  open: boolean
  label: string
  /** At the top, as in the sidebar. */
  brand: ReactNode
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useScrollLock(open)
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-text backdrop:bg-transparent md:hidden"
    >
      {open && (
        <>
          <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/60 motion-safe:animate-fade" />
          <div className="absolute inset-y-0 left-0 flex w-drawer max-w-[85vw] flex-col gap-4 overflow-y-auto border-r border-line bg-sidebar px-3 pt-3 pb-4 shadow-pop motion-safe:animate-sheet">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{brand}</div>
              <IconButton label="Close menu" icon="x" onClick={onClose} />
            </div>
            {children}
            {footer && <div className="mt-auto">{footer}</div>}
          </div>
        </>
      )}
    </dialog>
  )
}
