import { cx } from "./cx.ts"

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
  menu: "M4 7h16M4 12h16M4 17h16",
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
  moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z",
  person: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
  journal: "M5 4.5h14v15H5zM8.5 9h7M8.5 12h7M8.5 15h4",
  pause: "M9 5.5v13M15 5.5v13",
  filter: "M4 5.5h16l-6 7.5v5.5l-4 1.5v-7z",
  film: "M4.5 4.5h15v15h-15zM8 4.5v15M16 4.5v15M4.5 9h3.5M4.5 15h3.5M16 9h3.5M16 15h3.5",
  tv: "M3.5 6h17v11h-17zM8.5 20.5h7",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0",
  disk: "M3.5 13l2.5-8h12l2.5 8v6h-17zM3.5 13h17M16.5 16h.01"
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
    <span className="grid shrink-0 place-items-center rounded-logo bg-accent text-on-accent" style={{ width: size, height: size }}>
      <Icon name="logo" size={Math.round(size * 0.6)} strokeWidth={2.4} />
    </span>
  )
}
