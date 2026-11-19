import { RelayProtocol } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceAuth } from "./ServiceAuth.ts"

type CallResponse = typeof RelayProtocol.CallResponse.Type
type Failed = typeof RelayProtocol.Failed.Type

/** A form body is a flat object: qBittorrent's writes take `hashes=…&…`. */
const formFields = (body: unknown): Record<string, string> | null => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null
    fields[key] = String(value)
  }
  return fields
}

/**
 * Runs the calls the Core asks for, within the allowlist. Never fails: anything that goes wrong
 * is a `Failed` the Core can read.
 */
export class Calls extends Context.Service<Calls, {
  readonly run: (call: RelayProtocol.Call) => Effect.Effect<CallResponse | Failed>
}>()("quai-relay/Calls") {
  static readonly layer = Layer.effect(
    Calls,
    Effect.gen(function*() {
      const auth = yield* ServiceAuth
      const failed = (id: string, reason: string): Effect.Effect<Failed> =>
        Effect.succeed(RelayProtocol.Failed.make({ id, reason }))

      return {
        run: (call) => {
          if (!RelayProtocol.allowed(call)) return failed(call.id, "not allowed")
          if (!auth.configured.includes(call.service)) return failed(call.id, `${call.service} is not configured`)
          let request = call.method === "GET" ? HttpClientRequest.get(call.path) : HttpClientRequest.post(call.path)
          if (call.body !== undefined) {
            if (call.encoding === "form") {
              const fields = formFields(call.body)
              if (fields === null) return failed(call.id, "a form body must be a flat object")
              request = HttpClientRequest.bodyUrlParams(request, fields)
            } else {
              request = HttpClientRequest.bodyJsonUnsafe(request, call.body)
            }
          }
          return auth.execute(call.service, request).pipe(
            Effect.flatMap((response) => {
              const length = Number(response.headers["content-length"])
              if (length > RelayProtocol.maxBodyBytes) return failed(call.id, "too large")
              return Effect.map(response.text, (body): CallResponse | Failed =>
                Buffer.byteLength(body) > RelayProtocol.maxBodyBytes
                  ? RelayProtocol.Failed.make({ id: call.id, reason: "too large" })
                  : RelayProtocol.CallResponse.make({ id: call.id, status: response.status, body }))
            }),
            Effect.timeout("10 seconds"),
            Effect.catch((error) => failed(call.id, error._tag === "ServiceError" ? error.message : error._tag === "TimeoutError" ? "timed out" : "could not read the response"))
          )
        }
      }
    })
  )
}
