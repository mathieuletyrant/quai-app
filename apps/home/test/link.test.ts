import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Queue } from "effect"
import { Socket } from "effect/socket"
import { TestClock } from "effect/testing"
import { Link } from "../src/Link.ts"
import { Proxy } from "../src/Proxy.ts"
import { configLayer } from "./config.ts"

const close = Symbol("close")

/** One connection the agent opened: what the cloud sends it, and what it wrote. */
interface Connection {
  readonly incoming: Queue.Queue<string | typeof close>
  readonly sent: Queue.Queue<unknown>
}

/** A Socket whose every reader acquisition is a new connection, handed to the test. */
const fakeSocket = Effect.gen(function*() {
  const connections = yield* Queue.unbounded<Connection>()
  let latest: Connection | null = null
  const socket = Socket.make({
    reader: Effect.gen(function*() {
      const connection: Connection = { incoming: yield* Queue.unbounded<string | typeof close>(), sent: yield* Queue.unbounded<unknown>() }
      latest = connection
      yield* Queue.offer(connections, connection)
      return {
        pull: Effect.flatMap(Queue.take(connection.incoming), (frame) =>
          frame === close
            ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))
            : Effect.succeed([frame] as const)),
        upgrade: Socket.SocketUpgradeError.unsupported
      }
    }),
    writer: Effect.succeed({
      write: (chunk) => Queue.offer(latest!.sent, typeof chunk === "string" ? JSON.parse(chunk) : chunk).pipe(Effect.asVoid),
      writeAll: () => Effect.void
    })
  })
  return { socket, connections }
})

/** Answers every call with a 200 echoing its path. */
const echoProxy = Layer.succeed(Proxy, {
  run: (request) => Effect.succeed({ _tag: "ProxyResponse" as const, id: request.id, status: 200, body: request.path })
})

const withLink = <A, E>(
  test: (fake: Effect.Success<typeof fakeSocket>) => Effect.Effect<A, E, Link>
) =>
  Effect.gen(function*() {
    const fake = yield* fakeSocket
    return yield* test(fake).pipe(
      Effect.provide(Link.layer.pipe(Layer.provide([
        configLayer({ sonarr: null }),
        echoProxy,
        Layer.succeed(Socket.Socket, fake.socket)
      ])))
    )
  })

const cloud = (connection: Connection, message: object | string) =>
  Queue.offer(connection.incoming, typeof message === "string" ? message : JSON.stringify(message))

/** Lets forked fibers run up to their next wait. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 })

describe("link", () => {
  it.effect("says Hello first, with the configured services", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* Queue.take(connections)
        expect(yield* Queue.take(connection.sent)).toEqual({
          _tag: "Hello",
          protocol: 1,
          agentVersion: "dev",
          token: "agent-token",
          services: ["radarr", "qbittorrent", "jellyfin"]
        })
        const link = yield* Link
        expect(yield* link.linked).toBe(false)
        yield* cloud(connection, { _tag: "Welcome", homeName: "Home" })
        yield* settle
        expect(yield* link.linked).toBe(true)
      })))

  it.effect("answers a ProxyRequest with its ProxyResponse, and ignores what it can't read", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const connection = yield* Queue.take(connections)
        yield* Queue.take(connection.sent)
        yield* cloud(connection, "not json")
        yield* cloud(connection, { _tag: "Shutdown" })
        yield* cloud(connection, { _tag: "ProxyRequest", id: "42", service: "radarr", method: "GET", path: "/api/v3/system/status" })
        expect(yield* Queue.take(connection.sent)).toEqual({ _tag: "ProxyResponse", id: "42", status: 200, body: "/api/v3/system/status" })
      })))

  it.effect("sends webhooks while linked, drops them while not", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const link = yield* Link
        const connection = yield* Queue.take(connections)
        yield* Queue.take(connection.sent)
        yield* link.send({ _tag: "WebhookReceived", service: "radarr", body: { eventType: "Grab" } })
        expect(yield* Queue.take(connection.sent)).toEqual({ _tag: "WebhookReceived", service: "radarr", body: { eventType: "Grab" } })

        yield* Queue.offer(connection.incoming, close)
        yield* settle
        yield* link.send({ _tag: "WebhookReceived", service: "radarr", body: {} })
        expect(yield* Queue.size(connection.sent)).toBe(0)
      })))

  it.effect("reconnects after 1 s, 2 s, 4 s…, and starts over after a Welcome", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const reconnectsAfter = (seconds: number) =>
          Effect.gen(function*() {
            yield* TestClock.adjust(`${seconds * 1000 - 1} millis`)
            yield* settle
            expect(Option.isNone(yield* Queue.poll(connections))).toBe(true)
            yield* TestClock.adjust("1 millis")
            return yield* Queue.take(connections)
          })
        const first = yield* Queue.take(connections)
        yield* Queue.offer(first.incoming, close)
        const second = yield* reconnectsAfter(1)
        yield* Queue.offer(second.incoming, close)
        const third = yield* reconnectsAfter(2)
        yield* Queue.offer(third.incoming, close)
        const fourth = yield* reconnectsAfter(4)
        yield* cloud(fourth, { _tag: "Welcome", homeName: "Home" })
        yield* Queue.offer(fourth.incoming, close)
        yield* reconnectsAfter(1)
      })))

  it.effect("waits 5 minutes after a Refused", () =>
    withLink(({ connections }) =>
      Effect.gen(function*() {
        const first = yield* Queue.take(connections)
        yield* cloud(first, { _tag: "Refused", reason: "bad token" })
        yield* settle
        yield* TestClock.adjust("4 minutes")
        yield* settle
        expect(Option.isNone(yield* Queue.poll(connections))).toBe(true)
        yield* TestClock.adjust("1 minute")
        const second = yield* Queue.take(connections)
        expect(yield* Queue.take(second.sent)).toMatchObject({ _tag: "Hello" })
      })))
})
