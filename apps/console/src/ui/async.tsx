import type { ReactNode } from "react"
import { type Loaded, viewOf } from "../load.ts"

/**
 * What a page shows of something it reads: `children` with the data, else `offline` while Quai
 * Home isn't linked, `failed` after an error, and `loading` meanwhile. Left out, `offline` falls
 * back to `failed`, and `failed` to `loading`: a page that shows its error above keeps its outline.
 */
export function Async<A>({ state, loading, offline, failed, children }: {
  state: Loaded<A>
  loading: ReactNode
  offline?: ReactNode
  failed?: (error: unknown) => ReactNode
  children: (data: A) => ReactNode
}) {
  const view = viewOf(state)
  switch (view._tag) {
    case "Ready":
      return children(view.data)
    case "Loading":
      return loading
    case "Offline":
      if (offline !== undefined) return offline
      return failed === undefined ? loading : failed(state.error)
    case "Failed":
      return failed === undefined ? loading : failed(view.error)
  }
}
