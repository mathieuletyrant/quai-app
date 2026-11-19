import { AgentProtocol } from "@quai/api"
import { Context, Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceAuth } from "./ServiceAuth.ts"

export type ProxyResult = typeof AgentProtocol.ProxyResponse.Type | typeof AgentProtocol.ProxyFailure.Type

/**
 * Runs the calls the cloud asks for, within the allowlist. Never fails: anything that goes wrong
 * is a ProxyFailure the cloud can read.
 */
export class Proxy extends Context.Service<Proxy, {
  readonly run: (request: AgentProtocol.ProxyRequest) => Effect.Effect<ProxyResult>
}>()("quai-agent/Proxy") {
  static readonly layer = Layer.effect(
    Proxy,
    Effect.gen(function*() {
      const auth = yield* ServiceAuth
      const failure = (id: string, reason: string) => AgentProtocol.ProxyFailure.make({ id, reason })

      return {
        run: (request) => {
          if (!AgentProtocol.allowed(request)) return Effect.succeed(failure(request.id, "not allowed"))
          if (!auth.configured.includes(request.service)) {
            return Effect.succeed(failure(request.id, `${request.service} is not configured`))
          }
          const http = request.method === "GET"
            ? HttpClientRequest.get(request.path)
            : HttpClientRequest.post(request.path).pipe(
              request.body === undefined ? (r) => r : HttpClientRequest.bodyJsonUnsafe(request.body)
            )
          return auth.execute(request.service, http).pipe(
            Effect.flatMap((response) =>
              Effect.map(response.text, (body): ProxyResult =>
                AgentProtocol.ProxyResponse.make({ id: request.id, status: response.status, body })
              )
            ),
            Effect.timeout("10 seconds"),
            Effect.catch((error) =>
              Effect.succeed(failure(request.id, error._tag === "ServiceError" ? error.message : "timed out"))
            )
          )
        }
      }
    })
  )
}
