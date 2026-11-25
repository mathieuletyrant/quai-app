import type { ButtonHTMLAttributes } from "react"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"

/** What every control shares: its colour transition and how it looks disabled. */
export const control = "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40"

const buttonVariants = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-raised text-text ring-1 ring-line-strong ring-inset hover:bg-hover",
  ghost: "text-muted hover:bg-white/6 hover:text-text",
  danger: "text-danger-text ring-1 ring-danger/35 ring-inset hover:bg-danger-soft"
} as const

const buttonSizes = {
  md: { base: "h-9 px-3.5 text-body", withIcon: "pl-3" },
  sm: { base: "h-8 px-3 text-body", withIcon: "pl-2.5" }
} as const

export function Button(
  { variant = "primary", size = "md", icon, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof buttonVariants
    size?: keyof typeof buttonSizes
    icon?: IconName
  }
) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap",
        control,
        buttonSizes[size].base,
        icon && buttonSizes[size].withIcon,
        buttonVariants[variant],
        className
      )}
    >
      {icon && <Icon name={icon} size={15} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function IconButton(
  { label, icon, outlined, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string
    icon?: IconName
    outlined?: boolean
  }
) {
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
