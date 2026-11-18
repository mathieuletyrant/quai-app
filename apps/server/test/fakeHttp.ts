import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { HttpClientRequest } from "effect/http"

export interface Seen {
  readonly method: string
  readonly url: URL
  readonly headers: Record<string, string>
  readonly body: string | null
}

/** An HttpClient that answers from a routing function and records every request. */
export const fakeHttp = (
  route: (request: Seen) => { status?: number; json?: unknown; headers?: Record<string, string> },
  seen: Array<Seen> = []
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request: HttpClientRequest.HttpClientRequest, url) => {
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : null
      const entry: Seen = { method: request.method, url, headers: { ...request.headers }, body }
      seen.push(entry)
      const answer = route(entry)
      return Effect.succeed(HttpClientResponse.fromWeb(
        request,
        new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
          status: answer.status ?? 200,
          headers: { "content-type": "application/json", ...answer.headers }
        })
      ))
    })
  )
