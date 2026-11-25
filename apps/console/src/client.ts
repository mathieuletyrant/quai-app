import { type ConsoleAccess, HomeConsoleApi, QuaiApi } from "@quai/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { useEffect, useSyncExternalStore } from "react"

/** Typed client derived from the contract: changing a route in packages/api breaks compilation here. */
const client = HttpApiClient.make(QuaiApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

/** Quai Home's own routes (`/home-api`): the sign-in, the home and its services. */
const homeClient = HttpApiClient.make(HomeConsoleApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

type Client = Effect.Success<typeof client>
type HomeClient = Effect.Success<typeof homeClient>

/**
 * The console is served by Quai Home, which relays the Cloud's routes: they answer `HomeOffline`
 * (503) while Quai Home and Quai Cloud aren't linked (no `QUAI_CLOUD_URL`, or the Cloud down).
 */
export const isCloudOffline = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "HomeOffline"

/**
 * Whether Quai Home is linked to Quai Cloud, as the console last saw it. Any call answered
 * `HomeOffline` marks it offline; the shell's probe marks it back online. `epoch` grows at each
 * reconnection, so pages reload what they couldn't read.
 */
export type LinkStatus = "checking" | "online" | "offline"
let home: { readonly status: LinkStatus; readonly epoch: number } = { status: "checking", epoch: 0 }
const listeners = new Set<() => void>()
const setHome = (status: LinkStatus) => {
  if (home.status === status) return
  home = { status, epoch: status === "online" && home.status === "offline" ? home.epoch + 1 : home.epoch }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Runs one call to Quai Home's own routes at the React boundary. */
export const callHome = <A, E>(request: (client: HomeClient) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(homeClient, request))

/** Runs one call to Quai Cloud's routes, through Quai Home, at the React boundary. */
export const call = <A, E>(request: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(client, request)).catch((error: unknown) => {
    if (isCloudOffline(error)) setHome("offline")
    throw error
  })

/** Asks a route that needs the Cloud and the home's data: answered, they are linked. */
export const probeLink = () =>
  call((api) => api.console.devices()).then(() => setHome("online"), (error: unknown) => {
    // Anything but the Cloud being away may be the session that expired.
    if (!isCloudOffline(error)) void refreshSession()
  })

/** Whether this browser may open the console: `null` until Quai Home answered. */
export type SessionState = ConsoleAccess["state"] | null
let session: SessionState = null
const sessionListeners = new Set<() => void>()

/** Asks Quai Home where this browser stands (locked, signed out, signed in). */
export const refreshSession = () =>
  callHome((api) => api.session.access()).then(({ state }) => {
    if (session === state) return
    session = state
    sessionListeners.forEach((listener) => listener())
  }, () => undefined)

export const useSession = () =>
  useSyncExternalStore((listener) => {
    sessionListeners.add(listener)
    return () => {
      sessionListeners.delete(listener)
    }
  }, () => session)

export const useLink = () => useSyncExternalStore(subscribe, () => home)

/** Keeps probing the home: often while it's offline, rarely while it's linked, and when the tab comes back. */
export const useLinkProbe = () => {
  const { status } = useLink()
  useEffect(() => {
    void probeLink()
    const timer = setInterval(() => void probeLink(), status === "online" ? 30_000 : 5_000)
    const onFocus = () => void probeLink()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [status])
}
