import { HomeProtocol, journalSourceNames } from "@quai/api"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { Journal } from "./Journal.ts"
import { ServiceAuth } from "./ServiceAuth.ts"

type CallResponse = typeof HomeProtocol.CallResponse.Type
type Failed = typeof HomeProtocol.Failed.Type

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const unreadable = "against what it holds, which it couldn't read"

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

      /**
       * A write checked against what the service holds: its GET, then the rule's check. None when
       * it passes; why not in words otherwise (what it read, or couldn't, is never sent on).
       */
      const checkAgainst = (call: HomeProtocol.Call, against: NonNullable<HomeProtocol.AllowRule["against"]>) =>
        auth.execute(call.service, HttpClientRequest.get(against.path)).pipe(
          Effect.flatMap((response) => response.status === 200 ? response.text : Effect.succeed(null)),
          Effect.map((body) => {
            const current = body === null ? Option.none() : decodeJson(body)
            if (Option.isNone(current)) return unreadable
            return against.check(current.value, call.body) ? null : "that changes more than it may"
          }),
          Effect.timeout(`${HomeProtocol.defaultCallTimeoutSeconds} seconds`),
          Effect.orElseSucceed(() => unreadable)
        )

      const send = (call: HomeProtocol.Call, rule: HomeProtocol.AllowRule) =>
        auth.execute(call.service, requestOf(call)).pipe(
          Effect.flatMap((response) => {
            const length = Number(response.headers["content-length"])
            if (length > HomeProtocol.maxBodyBytes) return failed(call.id, "too large")
            return Effect.map(response.text, (body): CallResponse | Failed =>
              Buffer.byteLength(body) > HomeProtocol.maxBodyBytes
                ? HomeProtocol.Failed.make({ id: call.id, reason: "too large" })
                : HomeProtocol.CallResponse.make({ id: call.id, status: response.status, body }))
          }),
          Effect.timeout(`${rule.timeoutSeconds ?? HomeProtocol.defaultCallTimeoutSeconds} seconds`),
          Effect.tap(() => reached(call.service)),
          Effect.catch((error) => {
            const reason = error._tag === "ServiceError" ? error.message : error._tag === "TimeoutError" ? "timed out" : "could not read the response"
            return Effect.andThen(unreached(call.service, reason), failed(call.id, reason))
          })
        )

      return {
        run: (call) => {
          const rule = HomeProtocol.allowRule(call)
          if (rule === undefined) return refuse(call, "outside its allowlist")
          if (!auth.configured.includes(call.service)) return failed(call.id, `${call.service} is not configured`)
          const against = rule.against
          if (against === undefined) return send(call, rule)
          return Effect.flatMap(checkAgainst(call, against), (why) => why === null ? send(call, rule) : refuse(call, why))
        }
      }
    })
  )
}
