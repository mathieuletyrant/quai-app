import { HomeProtocol } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceAuth } from "./ServiceAuth.ts"

type CallResponse = typeof HomeProtocol.CallResponse.Type
type Failed = typeof HomeProtocol.Failed.Type

/**
 * Runs the calls the cloud asks for, within the allowlist (method, path and, for the writes that
 * need it, the body). Never fails: anything that goes wrong
 * is a `Failed` the cloud can read.
 */
export class Calls extends Context.Service<Calls, {
  readonly run: (call: HomeProtocol.Call) => Effect.Effect<CallResponse | Failed>
}>()("quai-home/Calls") {
  static readonly layer = Layer.effect(
    Calls,
    Effect.gen(function*() {
      const auth = yield* ServiceAuth
      const failed = (id: string, reason: string): Effect.Effect<Failed> =>
        Effect.succeed(HomeProtocol.Failed.make({ id, reason }))

      return {
        run: (call) => {
          const rule = HomeProtocol.allowRule(call)
          if (rule === undefined) return failed(call.id, "not allowed")
          if (!auth.configured.includes(call.service)) return failed(call.id, `${call.service} is not configured`)
          let request = call.method === "GET"
            ? HttpClientRequest.get(call.path)
            : call.method === "DELETE"
            ? HttpClientRequest.delete(call.path)
            : HttpClientRequest.post(call.path)
          if (call.body !== undefined) request = HttpClientRequest.bodyJsonUnsafe(request, call.body)
          return auth.execute(call.service, request).pipe(
            Effect.flatMap((response) => {
              const length = Number(response.headers["content-length"])
              if (length > HomeProtocol.maxBodyBytes) return failed(call.id, "too large")
              return Effect.map(response.text, (body): CallResponse | Failed =>
                Buffer.byteLength(body) > HomeProtocol.maxBodyBytes
                  ? HomeProtocol.Failed.make({ id: call.id, reason: "too large" })
                  : HomeProtocol.CallResponse.make({ id: call.id, status: response.status, body }))
            }),
            Effect.timeout(`${rule.timeoutSeconds ?? HomeProtocol.defaultCallTimeoutSeconds} seconds`),
            Effect.catch((error) => failed(call.id, error._tag === "ServiceError" ? error.message : error._tag === "TimeoutError" ? "timed out" : "could not read the response"))
          )
        }
      }
    })
  )
}
