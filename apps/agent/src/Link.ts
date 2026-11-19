import { AgentProtocol } from "@quai/api"
import { Context, Effect, Layer, Redacted, Ref, Schema, Semaphore } from "effect"
import { Socket } from "effect/socket"
import { AgentConfig, configuredServices } from "./Config.ts"
import { Proxy } from "./Proxy.ts"
import { agentVersion } from "./Version.ts"

const AgentJson = Schema.fromJsonString(AgentProtocol.AgentMessage)
const CloudJson = Schema.fromJsonString(AgentProtocol.CloudMessage)

/** Reads a frame from the cloud; anything we can't read is null. */
export const decodeCloudMessage = Schema.decodeUnknownOption(CloudJson)

/** Wait before reconnecting: 1 s doubling to 1 min. A Welcome starts over from 1 s. */
export const reconnectDelayMs = (failures: number) => Math.min(1_000 * 2 ** failures, 60_000)

/** After a Refused, the cloud won't take us back soon (bad token, old protocol): don't hammer it. */
export const refusedDelay = "5 minutes"

/** How many cloud calls run at once. */
const proxyConcurrency = 8

type Outcome = { readonly _tag: "Closed" } | { readonly _tag: "Refused"; readonly reason: string }

/**
 * The one WebSocket to the cloud. Says Hello on each connection, runs the cloud's calls through
 * the Proxy, and reconnects on its own.
 */
export class Link extends Context.Service<Link, {
  /** Sends a message to the cloud. Best effort: dropped while disconnected (the cloud also polls). */
  readonly send: (message: AgentProtocol.AgentMessage) => Effect.Effect<void>
  /** Whether the cloud welcomed this connection. */
  readonly linked: Effect.Effect<boolean>
}>()("quai-agent/Link") {
  static readonly layer = Layer.effect(
    Link,
    Effect.gen(function*() {
      const config = yield* AgentConfig
      const proxy = yield* Proxy
      const socket = yield* Socket.Socket
      const current = yield* Ref.make<((message: AgentProtocol.AgentMessage) => Effect.Effect<void>) | null>(null)
      const linked = yield* Ref.make(false)
      const failures = yield* Ref.make(0)

      const hello = AgentProtocol.Hello.make({
        protocol: AgentProtocol.protocolVersion,
        agentVersion,
        token: Redacted.value(config.token),
        services: configuredServices(config)
      })

      const connection = Effect.gen(function*() {
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        const write = (message: AgentProtocol.AgentMessage) =>
          Schema.encodeEffect(AgentJson)(message).pipe(
            Effect.flatMap(writer.write),
            Effect.catch((error) => Effect.logWarning(`could not send ${message._tag}`, error))
          )
        const semaphore = yield* Semaphore.make(proxyConcurrency)
        yield* write(hello)
        yield* Ref.set(current, write)
        yield* Effect.addFinalizer(() => Effect.andThen(Ref.set(current, null), Ref.set(linked, false)))

        while (true) {
          for (const frame of yield* pull) {
            const decoded = decodeCloudMessage(frame)
            if (decoded._tag === "None") {
              yield* Effect.logWarning("ignored a message from the cloud that isn't part of the protocol")
              continue
            }
            const message = decoded.value
            switch (message._tag) {
              case "Welcome":
                yield* Effect.logInfo(`linked to ${message.homeName}`)
                yield* Ref.set(failures, 0)
                yield* Ref.set(linked, true)
                break
              case "ProxyRequest":
                yield* Effect.forkScoped(semaphore.withPermit(Effect.flatMap(proxy.run(message), write)))
                break
              case "Refused":
                return { _tag: "Refused", reason: message.reason } satisfies Outcome
            }
          }
        }
      }).pipe(
        Effect.scoped,
        Effect.catchTag("SocketError", (error) =>
          Effect.as(Effect.logInfo(`cloud link down: ${error.message}`), { _tag: "Closed" } satisfies Outcome))
      )

      const loop = Effect.gen(function*() {
        while (true) {
          const outcome: Outcome = yield* connection
          if (outcome._tag === "Refused") {
            yield* Effect.logWarning(`the cloud refused this agent: ${outcome.reason}. Trying again in ${refusedDelay}`)
            yield* Ref.set(failures, 0)
            yield* Effect.sleep(refusedDelay)
          } else {
            yield* Effect.sleep(reconnectDelayMs(yield* Ref.getAndUpdate(failures, (n) => n + 1)))
          }
        }
      })
      yield* Effect.forkScoped(loop)

      return {
        linked: Ref.get(linked),
        send: (message) =>
          Effect.flatMap(Ref.get(current), (write) =>
            write === null ? Effect.logDebug(`not linked: dropped ${message._tag}`) : write(message))
      }
    })
  )
}
