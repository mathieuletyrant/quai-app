import { type Duration, Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import type { HttpClientRequest } from "effect/http"

export interface Seen {
  readonly method: string
  readonly url: URL
  readonly headers: Record<string, string>
  readonly body: string | null
}

/**
 * An HttpClient that answers from a routing function and records every request. `unreachable`
 * fails the call; `delay` answers after that long (on Clock, for TestClock).
 */
export const fakeHttp = (
  route: (
    request: Seen
  ) => {
    status?: number
    json?: unknown
    text?: string
    headers?: Record<string, string>
    unreachable?: true
    delay?: Duration.Input
  },
  seen: Array<Seen> = []
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request: HttpClientRequest.HttpClientRequest, url) => {
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : null
      const entry: Seen = { method: request.method, url, headers: { ...request.headers }, body }
      seen.push(entry)
      const answer = route(entry)
      if (answer.unreachable === true) {
        return Effect.fail(
          new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) })
        )
      }
      const response = Effect.succeed(HttpClientResponse.fromWeb(
        request,
        new Response(answer.text ?? (answer.json === undefined ? null : JSON.stringify(answer.json)), {
          status: answer.status ?? 200,
          headers: { "content-type": "application/json", ...answer.headers }
        })
      ))
      return answer.delay === undefined ? response : Effect.delay(response, answer.delay)
    })
  )
