// The demo home on Cloudflare, for App Review: one container running the preview server (the real
// Quai Cloud and a fake Quai Home on the recorded fixtures, `apps/cloud/test/preview.ts`), behind
// a Worker on demo.quai.stream. It holds everything in memory: a restart starts the demo over, so
// it sleeps only after 3 days without a request, longer than a review takes. No APNs key: no
// Live Activity. The code `QUAIDEMO` pairs any number of iPhones: the Worker trades it for a fresh
// one-time code, which only it can ask for.
import { Container } from "@cloudflare/containers"
import { isDemoCode, isPublic, withFreshCode } from "./demoPairing.ts"

interface Env {
  readonly QUAI_DEMO: DurableObjectNamespace<QuaiDemo>
}

export class QuaiDemo extends Container<Env> {
  override defaultPort = 8787
  override sleepAfter = "72h"
  override pingEndpoint = "localhost/api/health"
}

const demo = (env: Env) => env.QUAI_DEMO.jurisdiction("eu").getByName("quai-demo")

/** A fresh one-time pairing code, from the demo's own console route. */
const freshCode = async (env: Env, origin: string): Promise<string> => {
  const answer = await demo(env).fetch(
    new Request(`${origin}/console-api/pairing-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverUrls: [origin] })
    })
  )
  const { code } = await answer.json<{ code: string }>()
  return code
}

/** `POST /api/devices` with the demo code: sent on with a fresh code; anything else as it came. */
const pair = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const body = await request.clone().json<{ code?: unknown }>().catch(() => null)
  if (body === null || !isDemoCode(body.code)) return demo(env).fetch(request)
  const fresh = await freshCode(env, url.origin)
  return demo(env).fetch(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(withFreshCode(body, fresh))
    })
  )
}

export default {
  fetch: (request, env) => {
    const url = new URL(request.url)
    if (!isPublic(url.pathname)) return new Response("Not found", { status: 404 })
    if (request.method === "POST" && url.pathname === "/api/devices") return pair(request, env, url)
    return demo(env).fetch(request)
  }
} satisfies ExportedHandler<Env>
