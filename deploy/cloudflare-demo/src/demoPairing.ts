/** The code App Review types, with the server address `https://demo.quai.stream`. Public: it only reaches the demo. */
export const demoCode = "QUAIDEMO"

/** What an iPhone sends to pair (`POST /api/devices`), only the field the Worker reads. */
interface PairRequest {
  readonly code?: unknown
}

/** The demo code, typed in any case and with spaces around it, like Quai Cloud reads a code. */
export const isDemoCode = (code: unknown) => typeof code === "string" && code.trim().toUpperCase() === demoCode

/** Pairing with the demo code: the body sent on, with the fresh one-time code that stands for it. */
export const withFreshCode = <A extends PairRequest>(body: A, fresh: string): A => ({ ...body, code: fresh })

/**
 * Where a request may go. The demo's console routes answer only the Worker (`/console-api`, a fresh
 * pairing code): from outside, nobody pairs other iPhones' codes or changes the demo's flows.
 */
export const isPublic = (path: string) => !path.startsWith("/console-api")
