import { type ReactNode, useState } from "react"
import { cx } from "./cx.ts"
import { Icon, type IconName } from "./icons.tsx"

/** TMDB lists the original poster (several MB): a thumbnail asks for a 185 px wide one. */
const posterThumbnail = (url: string) => url.replace("/t/p/original/", "/t/p/w185/")

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
        className={cx("block h-15 w-10 rounded-lg bg-bg object-cover", state === "loading" && "invisible")}
      />
      {badge !== undefined && state === "loaded" && (
        <span className={cx("absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full bg-bg ring-2 ring-panel", badgeClassName)}>
          <Icon name={badge} size={11} strokeWidth={2.4} />
        </span>
      )}
    </span>
  )
}

/**
 * One title in a list: its poster, what it is and the facts about it, then its actions, which
 * wrap under it on narrow screens.
 */
export function MediaItem({ poster, title, detail, actions, children }: {
  poster: ReactNode
  title: ReactNode
  detail: ReactNode
  actions: ReactNode
  /** Under the row, full width: a panel the row opened. */
  children?: ReactNode
}) {
  return (
    <li className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        {poster}
        <div className="min-w-[min(100%,14rem)] flex-1">
          <p className="flex items-center gap-2 text-subhead font-semibold wrap-anywhere">{title}</p>
          <p className="mt-0.5 text-body text-muted wrap-anywhere">{detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </li>
  )
}

/** A list of MediaItem rows, inside a flush panel. */
export function MediaList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>
}
