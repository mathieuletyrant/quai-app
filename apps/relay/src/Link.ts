import { RelayProtocol } from "@quai/api"
import { Clock, Context, Effect, Layer, Queue, Ref, Schema, Semaphore } from "effect"
import { Socket } from "effect/socket"
import { Calls } from "./Calls.ts"
import { RelayConfig, configuredServices } from "./Config.ts"
import { HomeKey } from "./HomeKey.ts"
import { HomeStore } from "./HomeStore.ts"
import { relayVersion } from "./Version.ts"
import { Watches } from "./Watches.ts"

type RelayMessage = RelayProtocol.RelayMessage
type StoreRequest = Extract<RelayProtocol.CoreMessage, { readonly _tag: "StoreList" | "StorePut" | "StoreDelete" }>

const RelayJson = Schema.fromJsonString(RelayProtocol.RelayMessage)
const CoreJson = Schema.fromJsonString(RelayProtocol.CoreMessage)

/** Reads a frame from the Core; anything we can't read is None. */
export const decodeCoreMessage = Schema.decodeUnknownOption(CoreJson)

/** Wait before reconnecting: 1 s doubling to 1 min. A Welcome starts over from 1 s. */
export const reconnectDelayMs = (failures: number) => Math.min(1_000 * 2 ** failures, 60_000)

/** The Core pings every 20 s: this long without one, the link is dead even if the socket isn't closed. */
export const heartbeatTimeoutMs = 60_000

/** How many calls run at once. */
const callConcurrency = 8

type Outcome =
  | { readonly _tag: "Closed"; readonly reason: string }
  | { readonly _tag: "Refused"; readonly reason: string; readonly retryAfterSeconds: number }

/**
 * The one WebSocket to the Core. Proves the home key on each connection, runs the Core's calls,
 * watches and store operations, and reconnects on its own.
 */
export class Link extends Context.Service<Link, {
  /** Sends a message to the Core. Best effort: dropped while disconnected (the Core also polls). */
  readonly send: (message: RelayMessage) => Effect.Effect<void>
  /** Whether the Core welcomed this connection. */
  readonly linked: Effect.Effect<boolean>
}>()("quai-relay/Link") {
  static readonly layer = Layer.effect(
    Link,
    Effect.gen(function*() {
      const config = yield* RelayConfig
      const key = yield* HomeKey
      const calls = yield* Calls
      const watches = yield* Watches
      const store = yield* HomeStore
      const socket = yield* Socket.Socket
      const current = yield* Ref.make<((message: RelayMessage) => Effect.Effect<void>) | null>(null)
      const linked = yield* Ref.make(false)
      const failures = yield* Ref.make(0)

      const hello = RelayProtocol.Hello.make({
        protocol: RelayProtocol.protocolVersion,
        relayVersion,
        publicKey: key.publicKey,
        services: configuredServices(config)
      })

      const runStore = (request: StoreRequest): Effect.Effect<RelayMessage> => {
        const done = RelayProtocol.StoreDone.make({ id: request.id })
        const operation = request._tag === "StoreList"
          ? Effect.map(store.list(request.prefix), (documents) => RelayProtocol.StoreDocuments.make({ id: request.id, documents }))
          : request._tag === "StorePut"
          ? Effect.as(store.put(request.key, request.value), done)
          : Effect.as(store.delete(request.key), done)
        return Effect.catchTag(operation, "StoreError", (error) =>
          Effect.succeed(RelayProtocol.Failed.make({ id: request.id, reason: error.message })))
      }

      const connection = Effect.gen(function*() {
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        const write = (message: RelayMessage) =>
          Schema.encodeEffect(RelayJson)(message).pipe(
            Effect.flatMap(writer.write),
            Effect.catch((error) => Effect.logWarning(`could not send ${message._tag}`, error))
          )
        const semaphore = yield* Semaphore.make(callConcurrency)
        const watcher = yield* watches.make(write)
        // Store operations run one at a time, in the order the Core sent them.
        const storeQueue = yield* Queue.unbounded<StoreRequest>()
        yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(storeQueue), (r) => Effect.flatMap(runStore(r), write))))
        const lastPing = yield* Ref.make(yield* Clock.currentTimeMillis)

        yield* write(hello)
        yield* Ref.set(current, write)
        yield* Effect.addFinalizer(() => Effect.andThen(Ref.set(current, null), Ref.set(linked, false)))

        const read = Effect.gen(function*() {
          while (true) {
            for (const frame of yield* pull) {
              const decoded = decodeCoreMessage(frame)
              if (decoded._tag === "None") {
                yield* Effect.logWarning("ignored a message from the Core that isn't part of the protocol")
                continue
              }
              const message = decoded.value
              switch (message._tag) {
                case "Challenge":
                  yield* write(RelayProtocol.Proof.make({ signature: key.sign(message.nonce) }))
                  break
                case "Welcome":
                  if (message.homeId !== key.homeId) yield* Effect.logWarning(`the Core welcomed home ${message.homeId}, this is ${key.homeId}`)
                  yield* Effect.logInfo(`linked as home ${key.homeId}`)
                  yield* Ref.set(failures, 0)
                  yield* Ref.set(linked, true)
                  yield* watcher.reset
                  break
                case "Refused":
                  return { _tag: "Refused", reason: message.reason, retryAfterSeconds: message.retryAfterSeconds } satisfies Outcome
                case "Ping":
                  yield* Ref.set(lastPing, yield* Clock.currentTimeMillis)
                  yield* write(RelayProtocol.Pong.make({ at: message.at }))
                  break
                case "Call":
                  yield* Effect.forkScoped(semaphore.withPermit(Effect.flatMap(calls.run(message), write)))
                  break
                case "SetWatches":
                  yield* watcher.set(message.watches)
                  break
                case "StoreList":
                case "StorePut":
                case "StoreDelete":
                  yield* Queue.offer(storeQueue, message)
                  break
              }
            }
          }
        })

        const heartbeat = Effect.gen(function*() {
          while (true) {
            const silentFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastPing))
            if (silentFor >= heartbeatTimeoutMs) {
              return { _tag: "Closed", reason: `no ping for ${heartbeatTimeoutMs / 1000} s` } satisfies Outcome
            }
            yield* Effect.sleep(heartbeatTimeoutMs - silentFor)
          }
        })

        return yield* Effect.raceFirst(read, heartbeat)
      }).pipe(
        Effect.scoped,
        Effect.catchTag("SocketError", (error) => Effect.succeed({ _tag: "Closed", reason: error.message } satisfies Outcome))
      )

      const loop = Effect.gen(function*() {
        while (true) {
          const outcome: Outcome = yield* connection
          if (outcome._tag === "Refused") {
            const seconds = Math.max(1, outcome.retryAfterSeconds)
            yield* Effect.logWarning(`the Core refused this Relay: ${outcome.reason}. Trying again in ${seconds} s`)
            yield* Ref.set(failures, 0)
            yield* Effect.sleep(`${seconds} seconds`)
          } else {
            yield* Effect.logInfo(`link to the Core down: ${outcome.reason}`)
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
