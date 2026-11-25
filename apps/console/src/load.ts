import { type DependencyList, useCallback, useEffect, useRef, useState } from "react"
import { isCloudOffline } from "./client.ts"

/**
 * What a page read: the last data it got (null until the first answer) and why the last read
 * failed (null when it didn't). A failed read keeps the data it had.
 */
export interface Loaded<A> {
  readonly data: A | null
  readonly error: unknown
}

/** Where a read stands, from a `Loaded`: what a page shows in place of its data. */
export type View<A> =
  | { readonly _tag: "Ready"; readonly data: A }
  | { readonly _tag: "Offline" }
  | { readonly _tag: "Failed"; readonly error: unknown }
  | { readonly _tag: "Loading" }

export const viewOf = <A>({ data, error }: Loaded<A>): View<A> =>
  data !== null
    ? { _tag: "Ready", data }
    : error === null
    ? { _tag: "Loading" }
    : isCloudOffline(error)
    ? { _tag: "Offline" }
    : { _tag: "Failed", error }

/**
 * Reads `load` now and again whenever `deps` change; `refresh` reads it again. `setData` edits
 * what's shown (to drop a row at once), `setError` reports a failure of the page's own.
 */
export function useLoad<A>(load: () => Promise<A>, deps: DependencyList) {
  const [state, setState] = useState<Loaded<A>>({ data: null, error: null })
  const latest = useRef(load)
  latest.current = load
  const refresh = useCallback(() => {
    latest.current().then(
      (data) => setState({ data, error: null }),
      (error: unknown) => setState((current) => ({ ...current, error }))
    )
  }, [])
  useEffect(() => refresh(), [refresh, ...deps])
  return {
    ...state,
    refresh,
    setData: (update: (data: A) => A) => setState((current) => ({ ...current, data: current.data === null ? null : update(current.data) })),
    setError: (error: unknown) => setState((current) => ({ ...current, error }))
  }
}
