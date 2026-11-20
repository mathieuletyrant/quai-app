import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import type { HomeProtocol } from "@quai/api"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { ensureWebhook } from "../src/ArrWebhooks.ts"
import { ensureSeerrWebhook, seerrPayloadTemplate } from "../src/SeerrWebhook.ts"
import { Link } from "../src/Link.ts"
import { ServiceAuth } from "../src/ServiceAuth.ts"
import { HomeKey } from "../src/HomeKey.ts"
import { WebhooksLive } from "../src/Webhooks.ts"
import { configLayer } from "./config.ts"
import { fakeHttp, type Seen } from "./fakeHttp.ts"

const sent: Array<HomeProtocol.HomeMessage> = []
const fakeLink = Layer.succeed(Link, {
  send: (message) => Effect.sync(() => void sent.push(message)),
  linked: Effect.succeed(true)
})

const homeKey = Layer.succeed(HomeKey, { publicKey: "pk", homeId: "0123456789abcdef0123456789abcdef", sign: () => "sig", webhookToken: "s3cret" })

const server = HttpRouter.serve(WebhooksLive).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide([fakeLink, homeKey])
)

describe("webhook receiver", () => {
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
      yield* TestClock.adjust("1234 millis")
      expect((yield* post("s3cret")).status).toBe(204)
      expect(sent).toEqual([{ _tag: "WebhookReceived", service: "sonarr", receivedAt: 1234, body: { eventType: "Download" } }])
    }).pipe(Effect.provide(server)))

  it.effect("/health says whether the home is linked, and its id", () =>
    Effect.gen(function*() {
      const response = yield* (yield* HttpClient.HttpClient).get("/health")
      expect(yield* response.json).toEqual({ status: "ok", linked: true, homeId: "0123456789abcdef0123456789abcdef" })
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
    const url = "http://quai-home:8788/webhooks/radarr?token=t"
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

describe("Seerr webhook setup", () => {
  const token = "t"
  const url = `http://quai-home:8788/webhooks/seerr?token=${token}`
  const run = (current: object) => {
    const seen: Array<Seen> = []
    const http = fakeHttp((r) => r.method === "GET" ? { json: current } : { json: {} }, seen)
    return Effect.map(
      ensureSeerrWebhook(url, token).pipe(Effect.provide(ServiceAuth.layer.pipe(Layer.provide([configLayer(), http])))),
      (result) => ({ result, seen })
    )
  }

  it.effect("takes the webhook agent when it's off or has no URL: pending, approved and declined, with Quai's template", () =>
    Effect.gen(function*() {
      const { result, seen } = yield* run({ enabled: false, types: 0, options: { webhookUrl: "", jsonPayload: "" } })
      expect(result).toBe("created")
      expect(seen.map((r) => `${r.method} ${r.url.href}`)).toEqual([
        "GET http://seerr:5055/api/v1/settings/notifications/webhook",
        "POST http://seerr:5055/api/v1/settings/notifications/webhook"
      ])
      expect(seen[0]!.headers["x-api-key"]).toBe("masked")
      const body = JSON.parse(seen[1]!.body!)
      expect(body).toMatchObject({ enabled: true, types: 2 | 4 | 64, options: { webhookUrl: url } })
      expect(JSON.parse(Buffer.from(body.options.jsonPayload, "base64").toString("utf8"))).toEqual(seerrPayloadTemplate)
      expect((yield* run({ enabled: true, types: 4, options: { webhookUrl: "" } })).result).toBe("created")
    }))

  it.effect("updates it when it's already Quai's receiver", () =>
    Effect.gen(function*() {
      const { result, seen } = yield* run({ enabled: true, types: 2, options: { webhookUrl: "http://old-host:8788/webhooks/seerr?token=t" } })
      expect(result).toBe("updated")
      expect(JSON.parse(seen[1]!.body!).options.webhookUrl).toBe(url)
    }))

  it.effect("leaves someone else's webhook untouched", () =>
    Effect.gen(function*() {
      for (const other of ["https://hooks.example.com/seerr", "http://quai-home:8788/webhooks/seerr?token=another-home"]) {
        const { result, seen } = yield* run({ enabled: true, types: 222, options: { webhookUrl: other } })
        expect(result).toBe("taken")
        expect(seen.map((r) => r.method)).toEqual(["GET"])
      }
    }))
})
