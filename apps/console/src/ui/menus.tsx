import { type ButtonHTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"
import { overline } from "./layout.tsx"

/** How far a panel must move to stay `margin` px inside the viewport. */
const shiftIntoView = (rect: DOMRect, margin = 12) =>
  rect.left < margin ? margin - rect.left : rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0

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
    setShift(shiftIntoView(panel.current.getBoundingClientRect()))
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
        "flex w-full items-center gap-3 rounded-item px-2.5 py-2 text-left text-body transition-colors hover:bg-white/6 focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-40",
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
  return <p className={cx("px-2.5 pt-2 pb-1", overline)}>{children}</p>
}

export function MenuSeparator() {
  return <span role="separator" className="mx-1 my-1 h-px bg-line" />
}
