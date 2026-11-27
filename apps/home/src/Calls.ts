import { journalSourceNames, type Service } from "@quai/api"
import type { CallRequest } from "@quai/domain/home/HomeLink.ts"
import { type Cause, Context, Effect, Layer } from "effect"
import { type HttpClientError, HttpClientRequest } from "effect/http"
import type { ServiceError } from "./Errors.ts"
import { Journal } from "./Journal.ts"
import { ServiceAuth } from "./ServiceAuth.ts"

/** What a service answered a call, or why it didn't. */
export type CallAnswer =
  | { readonly _tag: "Answered"; readonly status: number; readonly body: string }
  | { readonly _tag: "Failed"; readonly reason: string }

/**
 * Largest response body Quai reads; bigger ones come back as a failure. Sized for the library
 * lists: Radarr's `/api/v3/movie` runs to a few kilobytes per title.
 */
export const maxBodyBytes = 16_000_000

/** Quai Home waits this long for a service, unless the call says otherwise. */
export const defaultCallTimeoutMs = 10_000

const failed = (reason: string): CallAnswer => ({ _tag: "Failed", reason })

/**
 * Runs the calls Quai makes to the services, on the LAN, with their keys. Never fails: anything that
 * goes wrong is a `Failed` the caller can read. The journal gets a line when a service stops
 * answering (unreachable, a login refused, too slow) and when it answers again: once per streak,
 * not per call.
 */
export class Calls extends Context.Service<Calls, {
  readonly run: (call: CallRequest, options?: { readonly timeoutMs?: number }) => Effect.Effect<CallAnswer>
}>()("quai-home/Calls") {
  static readonly layer = Layer.effect(
    Calls,
    Effect.gen(function*() {
      const auth = yield* ServiceAuth
      const journal = yield* Journal
      /** Why each service doesn't answer, while it doesn't. */
      const failing = new Map<Service, string>()
      const reached = (service: Service) =>
        Effect.suspend(() => {
          if (!failing.delete(service)) return Effect.void
          return journal.note({
            level: "info",
            source: service,
            kind: "service.reached",
            text: `Quai Home reaches ${journalSourceNames[service]} again`
          })
        })
      const unreached = (service: Service, reason: string) =>
        Effect.suspend(() => {
          if (failing.get(service) === reason) return Effect.void
          failing.set(service, reason)
          return journal.note({
            level: "warn",
            source: service,
            kind: "service.unreached",
            text: `Quai Home can't reach ${journalSourceNames[service]}: ${reason}`
          })
        })

      const requestOf = (call: CallRequest) => {
        const request = call.method === "GET"
          ? HttpClientRequest.get(call.path)
          : call.method === "DELETE"
          ? HttpClientRequest.delete(call.path)
          : call.method === "PUT"
          ? HttpClientRequest.put(call.path)
          : HttpClientRequest.post(call.path)
        return call.body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, call.body)
      }

      /** A call's answer, or why there's none: a too-large body is a `Failed`; what didn't answer fails. */
      const exchange = (call: CallRequest) =>
        Effect.flatMap(auth.execute(call.service, requestOf(call)), (response) => {
          const length = Number(response.headers["content-length"])
          if (length > maxBodyBytes) return Effect.succeed(failed("too large"))
          return Effect.map(
            response.text,
            (body): CallAnswer =>
              Buffer.byteLength(body) > maxBodyBytes
                ? failed("too large")
                : { _tag: "Answered", status: response.status, body }
          )
        })

      /** The service didn't answer (unreachable, a login refused, too slow): the journal hears it once, the caller each time. */
      const notAnswered =
        (call: CallRequest) => (error: ServiceError | HttpClientError.HttpClientError | Cause.TimeoutError) => {
          const reason = error._tag === "ServiceError"
            ? error.message
            : error._tag === "TimeoutError"
            ? "timed out"
            : "could not read the response"
          return Effect.as(unreached(call.service, reason), failed(reason))
        }

      return {
        run: (call, options) =>
          Effect.flatMap(auth.configured, (configured) =>
            !configured.includes(call.service)
              ? Effect.succeed(failed(`${call.service} is not configured`))
              : exchange(call).pipe(
                Effect.timeout(options?.timeoutMs ?? defaultCallTimeoutMs),
                Effect.tap(() => reached(call.service)),
                Effect.catch(notAnswered(call))
              ))
      }
    })
  )
}
