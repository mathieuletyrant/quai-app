import { Effect } from "effect"
import * as http2 from "node:http2"
import type { AddressInfo } from "node:net"

export interface ApnsHit {
  readonly path: string
  readonly headers: http2.IncomingHttpHeaders
  readonly body: any
}

/**
 * A local cleartext HTTP/2 server that answers like APNs and records every push. Tokens starting
 * with "dead" get 410 Unregistered; tokens starting with "silent" never get an answer.
 * `connections` counts the HTTP/2 sessions clients opened.
 */
export const fakeApns = Effect.acquireRelease(
  Effect.callback<{ url: string; hits: Array<ApnsHit>; connections: () => number; server: http2.Http2Server }>((resume) => {
    const hits: Array<ApnsHit> = []
    let connections = 0
    const server = http2.createServer()
    server.on("session", () => connections++)
    server.on("stream", (stream, headers) => {
      let body = ""
      stream.setEncoding("utf8")
      stream.on("data", (chunk: string) => (body += chunk))
      stream.on("end", () => {
        const path = String(headers[":path"])
        hits.push({ path, headers, body: JSON.parse(body) })
        if (path.includes("/silent")) return
        if (path.includes("/dead")) {
          stream.respond({ ":status": 410 })
          stream.end(JSON.stringify({ reason: "Unregistered", timestamp: 0 }))
        } else {
          stream.respond({ ":status": 200, "apns-id": "x" })
          stream.end()
        }
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resume(Effect.succeed({ url: `http://127.0.0.1:${port}`, hits, connections: () => connections, server }))
    })
  }),
  ({ server }) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void)))
)
