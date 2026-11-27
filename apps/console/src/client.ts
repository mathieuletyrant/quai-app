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
 * Quai Home serves the console and answers it with Quai's routes, which it runs itself. For the
 * second or two it takes to start, they answer `HomeOffline` (503): not ready yet.
 */
export const isNotReady = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "HomeOffline"

/**
 * Whether Quai Home is linked to Quai Cloud, as it last said (`/home-api/home`). Nothing here
 * needs the link: without it the app can't reach this home from outside and nothing is pushed.
 * `epoch` grows when the link comes back, and once Quai Home is ready, so pages read again.
 */
export type LinkStatus = "checking" | "online" | "offline"
let home: { readonly status: LinkStatus; readonly epoch: number } = { status: "checking", epoch: 0 }
const listeners = new Set<() => void>()
const changed = (next: typeof home) => {
  home = next
  listeners.forEach((listener) => listener())
}
const setHome = (status: LinkStatus) => {
  if (home.status === status) return
  changed({ status, epoch: status === "online" && home.status === "offline" ? home.epoch + 1 : home.epoch })
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** How long after a "not ready" the pages read again. */
const readAgainMs = 2_000
let readingAgain = false
/** Quai Home wasn't ready: the pages read again in a moment, once for however many calls said so. */
const readAgainSoon = () => {
  if (readingAgain) return
  readingAgain = true
  setTimeout(() => {
    readingAgain = false
    changed({ ...home, epoch: home.epoch + 1 })
  }, readAgainMs)
}

/** Runs one call to Quai Home's own routes at the React boundary. */
export const callHome = <A, E>(request: (client: HomeClient) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(homeClient, request))

/** Runs one call to Quai's routes (`/console-api`, `/api/health`), which Quai Home answers, at the React boundary. */
export const call = <A, E>(request: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(client, request)).catch((error: unknown) => {
    if (isNotReady(error)) readAgainSoon()
    throw error
  })

/** Asks Quai Home whether it is linked to Quai Cloud. No answer may be the session that expired. */
export const probeLink = () =>
  callHome((api) => api.home.overview()).then(
    (overview) => setHome(overview.cloud.linked ? "online" : "offline"),
    () => void refreshSession()
  )

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

/** Keeps asking about the link: often while it's down, rarely while it's up, and when the tab comes back. */
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
