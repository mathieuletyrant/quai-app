import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import type { AgentProtocol } from "@quai/api"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { ensureWebhook } from "../src/ArrWebhooks.ts"
import { Link } from "../src/Link.ts"
import { ServiceAuth } from "../src/ServiceAuth.ts"
import { webhookToken, WebhooksLive } from "../src/Webhooks.ts"
import { configLayer, testConfig } from "./config.ts"
import { fakeHttp, type Seen } from "./fakeHttp.ts"

const sent: Array<AgentProtocol.AgentMessage> = []
const fakeLink = Layer.succeed(Link, {
  send: (message) => Effect.sync(() => void sent.push(message)),
  linked: Effect.succeed(true)
})

const server = HttpRouter.serve(WebhooksLive).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide([fakeLink, configLayer()])
)

describe("webhook receiver", () => {
  it("derives the token from the agent token", () => {
    expect(webhookToken(testConfig.token)).toMatch(/^[0-9a-f]{32}$/)
    expect(webhookToken(testConfig.token)).toBe(webhookToken(Redacted.make("agent-token")))
    expect(webhookToken(Redacted.make("other"))).not.toBe(webhookToken(testConfig.token))
  })

  it.effect("forwards a webhook with the right token, refuses the others", () =>
    Effect.gen(function*() {
      sent.length = 0
      const client = yield* HttpClient.HttpClient
      const post = (token: string) =>
        client.execute(HttpClientRequest.post(`/webhooks/sonarr?token=${token}`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ eventType: "Download" })
        ))
      expect((yield* post("nope")).status).toBe(401)
      expect(sent).toEqual([])
      expect((yield* post(webhookToken(testConfig.token))).status).toBe(204)
      expect(sent).toEqual([{ _tag: "WebhookReceived", service: "sonarr", body: { eventType: "Download" } }])
    }).pipe(Effect.provide(server)))

  it.effect("/health says whether the agent is linked", () =>
    Effect.gen(function*() {
      const response = yield* (yield* HttpClient.HttpClient).get("/health")
      expect(yield* response.json).toEqual({ status: "ok", linked: true })
    }).pipe(Effect.provide(server)))
})

describe("webhook setup", () => {
  it.effect("creates Quai's webhook once, then updates it in place", () => {
    const seen: Array<Seen> = []
    let existing: Array<object> = [{ id: 3, name: "Discord", implementation: "Discord" }]
    const http = fakeHttp((r) => {
      if (r.method === "GET") return { json: existing }
      existing = [...existing, { id: 9, name: "Quai", implementation: "Webhook" }]
      return { status: r.method === "POST" ? 201 : 202, json: {} }
    }, seen)
    const url = "http://quai-agent:8788/webhooks/radarr?token=t"
    return Effect.gen(function*() {
      expect(yield* ensureWebhook("radarr", url)).toBe("created")
      expect(yield* ensureWebhook("radarr", url)).toBe("updated")
      expect(seen.map((r) => `${r.method} ${r.url.href}`)).toEqual([
        "GET http://radarr:7878/api/v3/notification",
        "POST http://radarr:7878/api/v3/notification",
        "GET http://radarr:7878/api/v3/notification",
        "PUT http://radarr:7878/api/v3/notification/9"
      ])
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      const body = JSON.parse(seen[1]!.body!)
      expect(body).toMatchObject({ name: "Quai", implementation: "Webhook", onGrab: true, onDownload: true, onMovieAdded: true })
      expect(body.fields).toContainEqual({ name: "url", value: url })
    }).pipe(Effect.provide(ServiceAuth.layer.pipe(Layer.provide([configLayer(), http]))))
  })
})
