import { HomeProtocol, journalSourceNames } from "@quai/api"
import { type Cause, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { type HttpClientError, HttpClientRequest } from "effect/http"
import type { ServiceError } from "./Errors.ts"
import { Journal } from "./Journal.ts"
import { ServiceAuth } from "./ServiceAuth.ts"

type CallResponse = typeof HomeProtocol.CallResponse.Type
type Failed = typeof HomeProtocol.Failed.Type

/** What a checked write's read says: it may go, it may not (and why), or the service didn't answer. */
type Verdict =
  | { readonly _tag: "Allowed" }
  | { readonly _tag: "Refused"; readonly why: string }
  | { readonly _tag: "Unanswered"; readonly reason: string }

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const unreadable = "against what it holds, which it can't read"

/**
 * Runs the calls the cloud asks for, within the allowlist (method, path and, for the writes that
 * need it, the body; for a write that replaces a whole document, the body against what the service
 * holds, read just before). Never fails: anything that goes wrong
 * is a `Failed` the cloud can read. The journal gets each refusal, and a line when a service
 * stops answering (unreachable, a login refused, too slow) and when it answers again: once per
 * streak, not per call.
 */
export class Calls extends Context.Service<Calls, {
  readonly run: (call: HomeProtocol.Call) => Effect.Effect<CallResponse | Failed>
}>()("quai-home/Calls") {
  static readonly layer = Layer.effect(
    Calls,
    Effect.gen(function*() {
      const auth = yield* ServiceAuth
      const journal = yield* Journal
      const failed = (id: string, reason: string): Effect.Effect<Failed> =>
        Effect.succeed(HomeProtocol.Failed.make({ id, reason }))
      /** Why each service doesn't answer, while it doesn't. */
      const failing = new Map<HomeProtocol.HomeService, string>()
      const reached = (service: HomeProtocol.HomeService) =>
        Effect.suspend(() => {
          if (!failing.delete(service)) return Effect.void
          return journal.note({ level: "info", source: service, kind: "service.reached", text: `Quai Home reaches ${journalSourceNames[service]} again` })
        })
      const unreached = (service: HomeProtocol.HomeService, reason: string) =>
        Effect.suspend(() => {
          if (failing.get(service) === reason) return Effect.void
          failing.set(service, reason)
          return journal.note({ level: "warn", source: service, kind: "service.unreached", text: `Quai Home can't reach ${journalSourceNames[service]}: ${reason}` })
        })

      const refuse = (call: HomeProtocol.Call, why: string) =>
        Effect.andThen(
          journal.note({
            level: "warn",
            source: call.service,
            kind: "call.refused",
            text: `Quai Home refused a call ${why}: ${journalSourceNames[call.service]} ${call.method} ${call.path.split("?")[0]}`
          }),
          failed(call.id, "not allowed")
        )

      const requestOf = (call: HomeProtocol.Call) => {
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
      const exchange = (call: HomeProtocol.Call) =>
        Effect.flatMap(auth.execute(call.service, requestOf(call)), (response) => {
          const length = Number(response.headers["content-length"])
          if (length > HomeProtocol.maxBodyBytes) return failed(call.id, "too large")
          return Effect.map(response.text, (body): CallResponse | Failed =>
            Buffer.byteLength(body) > HomeProtocol.maxBodyBytes
              ? HomeProtocol.Failed.make({ id: call.id, reason: "too large" })
              : HomeProtocol.CallResponse.make({ id: call.id, status: response.status, body }))
        })

      /** The service didn't answer (unreachable, a login refused, too slow): the journal hears it once, the cloud each time. */
      const notAnswered = (call: HomeProtocol.Call) => (error: ServiceError | HttpClientError.HttpClientError | Cause.TimeoutError) => {
        const reason = error._tag === "ServiceError" ? error.message : error._tag === "TimeoutError" ? "timed out" : "could not read the response"
        return Effect.andThen(unreached(call.service, reason), failed(call.id, reason))
      }

      const send = (call: HomeProtocol.Call, rule: HomeProtocol.AllowRule) =>
        exchange(call).pipe(
          Effect.timeout(`${rule.timeoutSeconds ?? HomeProtocol.defaultCallTimeoutSeconds} seconds`),
          Effect.tap(() => reached(call.service)),
          Effect.catch(notAnswered(call))
        )

      /**
       * What the service holds, read for a checked write, and the rule's verdict: `null` when the
       * write may go, why not otherwise. What it read is never sent on. Not answering (a non-2xx
       * included) is `unanswered`, not a refusal.
       */
      const verdict = (call: HomeProtocol.Call, against: NonNullable<HomeProtocol.AllowRule["against"]>) =>
        Effect.flatMap(auth.execute(call.service, HttpClientRequest.get(against.path)), (response) => {
          if (response.status < 200 || response.status >= 300) return Effect.succeed<Verdict>({ _tag: "Unanswered", reason: `HTTP ${response.status}` })
          if (Number(response.headers["content-length"]) > HomeProtocol.maxBodyBytes) return Effect.succeed<Verdict>({ _tag: "Refused", why: unreadable })
          return Effect.map(response.text, (body): Verdict => {
            const current = Buffer.byteLength(body) > HomeProtocol.maxBodyBytes ? Option.none() : decodeJson(body)
            if (Option.isNone(current)) return { _tag: "Refused", why: unreadable }
            return against.check(current.value, call.body) ? { _tag: "Allowed" } : { _tag: "Refused", why: "that changes more than it may" }
          })
        })

      /** Checked writes go one at a time: two read at once would both pass, and the second would undo the first. */
      const oneAtATime = yield* Semaphore.make(1)

      /**
       * A write checked against what the service holds: its read, the rule's check, then the write,
       * one at a time, within `checkedWriteTimeoutSeconds` from the wait to the answer.
       */
      const checked = (call: HomeProtocol.Call, against: NonNullable<HomeProtocol.AllowRule["against"]>) =>
        Effect.gen(function*() {
          const outcome = yield* verdict(call, against)
          if (outcome._tag === "Unanswered") return yield* Effect.andThen(unreached(call.service, outcome.reason), failed(call.id, outcome.reason))
          yield* reached(call.service)
          if (outcome._tag === "Refused") return yield* refuse(call, outcome.why)
          return yield* exchange(call)
        }).pipe(
          Semaphore.withPermit(oneAtATime),
          Effect.timeout(`${HomeProtocol.checkedWriteTimeoutSeconds} seconds`),
          Effect.catch(notAnswered(call))
        )

      return {
        run: (call) => {
          const rule = HomeProtocol.allowRule(call)
          if (rule === undefined) return refuse(call, "outside its allowlist")
          if (!auth.configured.includes(call.service)) return failed(call.id, `${call.service} is not configured`)
          return rule.against === undefined ? send(call, rule) : checked(call, rule.against)
        }
      }
    })
  )
}
