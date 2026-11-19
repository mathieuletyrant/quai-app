import { QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { useEffect, useSyncExternalStore } from "react"

/** Typed client derived from the contract: changing a route in packages/api breaks compilation here. */
const client = HttpApiClient.make(QuaiApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

type Client = Effect.Success<typeof client>

/** The Cloud answers `HomeOffline` (503) on every route that needs the home's data while Quai Home isn't linked. */
export const isHomeOffline = (e: unknown) =>
  typeof e === "object" && e !== null && "_tag" in e && e._tag === "HomeOffline"

/**
 * Whether Quai Home is linked to the Cloud, as the console last saw it. Any call answered
 * `HomeOffline` marks it offline; the shell's probe marks it back online. `epoch` grows at each
 * reconnection, so pages reload what they couldn't read.
 */
export type HomeStatus = "checking" | "online" | "offline"
let home: { readonly status: HomeStatus; readonly epoch: number } = { status: "checking", epoch: 0 }
const listeners = new Set<() => void>()
const setHome = (status: HomeStatus) => {
  if (home.status === status) return
  home = { status, epoch: status === "online" && home.status === "offline" ? home.epoch + 1 : home.epoch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Runs one call at the React boundary. */
export const call = <A, E>(f: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(client, f)).catch((e: unknown) => {
    if (isHomeOffline(e)) setHome("offline")
    throw e
  })

/** Asks a route that needs the home: answered, the home is linked. */
export const probeHome = () =>
  call((c) => c.console.devices()).then(() => setHome("online"), () => undefined)

export const useHome = () => useSyncExternalStore(subscribe, () => home)

/** Keeps probing the home: often while it's offline, rarely while it's linked, and when the tab comes back. */
export const useHomeProbe = () => {
  const { status } = useHome()
  useEffect(() => {
    void probeHome()
    const timer = setInterval(() => void probeHome(), status === "online" ? 30_000 : 5_000)
    const onFocus = () => void probeHome()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [status])
}
