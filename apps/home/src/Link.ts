import { HomeProtocol } from "@quai/api"
import { Clock, Context, Deferred, Effect, Layer, PubSub, Queue, Ref, Schema, Semaphore } from "effect"
import { Socket } from "effect/socket"
import { Calls } from "./Calls.ts"
import { CloudSeen } from "./CloudSeen.ts"
import { configuredServices, HomeConfig } from "./Config.ts"
import { CloudUnreachable, type StoreError } from "./Errors.ts"
import { HomeKey } from "./HomeKey.ts"
import { HomeStore } from "./HomeStore.ts"
import { Journal } from "./Journal.ts"
import { ServiceSettings } from "./ServiceSettings.ts"
import { homeVersion } from "./Version.ts"
import { Watches } from "./Watches.ts"

type HomeMessage = HomeProtocol.HomeMessage
type StoreRequest = Extract<HomeProtocol.CloudMessage, { readonly _tag: "StoreList" | "StorePut" | "StoreDelete" }>

const HomeJson = Schema.fromJsonString(HomeProtocol.HomeMessage)
const CloudJson = Schema.fromJsonString(HomeProtocol.CloudMessage)

/** Reads a frame from the cloud; anything we can't read is None. */
export const decodeCloudMessage = Schema.decodeUnknownOption(CloudJson)

/** Wait before reconnecting: 1 s doubling to 1 min. A Welcome starts over from 1 s. */
export const reconnectDelayMs = (failures: number) => Math.min(1_000 * 2 ** failures, 60_000)

/** The cloud pings every 20 s: this long without one, the link is dead even if the socket isn't closed. */
export const heartbeatTimeoutMs = 60_000

/** How long the console waits for Quai Cloud to answer one of its requests. */
export const consoleRequestTimeoutMs = 20_000

/** What the console is told while there's no Cloud to relay to. */
export const noCloudMessage = "No Quai Cloud is set: set QUAI_CLOUD_URL on Quai Home"
export const notLinkedMessage = "Quai Cloud isn't reachable"

/** A console request, as Quai Home relays it. */
export type ConsoleRequest = Omit<HomeProtocol.ConsoleRequest, "_tag" | "id">

/** At most this many webhooks wait for the link to come back; past it, the oldest go. */
export const heldWebhooksLimit = 100

const callConcurrency = 8

type Outcome =
  | { readonly _tag: "Closed"; readonly reason: string }
  | { readonly _tag: "Refused"; readonly reason: string; readonly retryAfterSeconds: number }

/**
 * The one WebSocket to the cloud. Proves the home key on each connection, runs the cloud's calls,
 * watches and store operations, and reconnects on its own.
 */
export class Link extends Context.Service<Link, {
  /**
   * Sends a message to the cloud. While the link is down (the hosted Cloud's drops a few times a day,
   * for seconds) it waits, up to `heldWebhooksLimit`, and goes once the Cloud welcomes this home again.
   */
  readonly send: (message: HomeMessage) => Effect.Effect<void>
  /** Whether the cloud welcomed this connection. */
  readonly linked: Effect.Effect<boolean>
  /** Relays one of the console's requests to the Cloud, and its answer back. */
  readonly console: (
    request: ConsoleRequest
  ) => Effect.Effect<{ readonly status: number; readonly body: string }, CloudUnreachable>
}>()("quai-home/Link") {
  /** No `QUAI_CLOUD_URL`: nothing to link to, every console request says so. */
  static readonly unlinked = Layer.succeed(Link, {
    send: (message) => Effect.logDebug(`no Quai Cloud: dropped ${message._tag}`),
    linked: Effect.succeed(false),
    console: () => Effect.fail(new CloudUnreachable({ message: noCloudMessage }))
  })

  static readonly layer = Layer.effect(
    Link,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const settings = yield* ServiceSettings
      const cloudSeen = yield* CloudSeen
      const key = yield* HomeKey
      const calls = yield* Calls
      const watches = yield* Watches
      const store = yield* HomeStore
      const journal = yield* Journal
      const socket = yield* Socket.Socket
      const current = yield* Ref.make<((message: HomeMessage) => Effect.Effect<void>) | null>(null)
      const linked = yield* Ref.make(false)
      const failures = yield* Ref.make(0)
      const consoleCount = yield* Ref.make(0)
      /** What came while the link was down. Sends and the flush on Welcome take turns. */
      const held: Array<HomeMessage> = []
      const gate = yield* Semaphore.make(1)
      /** The console's requests waiting for the Cloud's answer, on the current connection. */
      const consolePending = new Map<string, Deferred.Deferred<HomeProtocol.ConsoleResponse, CloudUnreachable>>()

      const hello = Effect.map(settings.current, (endpoints) =>
        HomeProtocol.Hello.make({
          protocol: HomeProtocol.protocolVersion,
          homeVersion,
          publicKey: key.publicKey,
          services: configuredServices(endpoints),
          webUrls: config.webUrls
        }))

      const runStore = (request: StoreRequest): Effect.Effect<HomeMessage> => {
        const done = HomeProtocol.StoreDone.make({ id: request.id })
        const operation: Effect.Effect<HomeMessage, StoreError> = request._tag === "StoreList"
          ? Effect.map(
            store.list(request.prefix),
            (documents) => HomeProtocol.StoreDocuments.make({ id: request.id, documents })
          )
          : request._tag === "StorePut"
          ? Effect.as(store.put(request.key, request.value), done)
          : Effect.as(store.delete(request.key), done)
        return operation.pipe(
          Effect.catchTag(
            "StoreError",
            (error) => Effect.succeed(HomeProtocol.Failed.make({ id: request.id, reason: error.message }))
          )
        )
      }

      const connection = Effect.gen(function*() {
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        const write = (message: HomeMessage) =>
          Schema.encodeEffect(HomeJson)(message).pipe(
            Effect.flatMap(writer.write),
            Effect.catch((error) => Effect.logWarning(`could not send ${message._tag}`, error))
          )
        const semaphore = yield* Semaphore.make(callConcurrency)
        const watcher = yield* watches.make(write)
        // Store operations run one at a time, in the order the cloud sent them.
        const storeQueue = yield* Queue.unbounded<StoreRequest>()
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.flatMap(Queue.take(storeQueue), (storeRequest) => Effect.flatMap(runStore(storeRequest), write))
          )
        )
        const lastPing = yield* Ref.make(yield* Clock.currentTimeMillis)

        yield* write(yield* hello)
        yield* Ref.set(current, write)
        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            yield* Ref.set(current, null)
            yield* Ref.set(linked, false)
            for (const answer of consolePending.values()) {
              yield* Deferred.fail(answer, new CloudUnreachable({ message: notLinkedMessage }))
            }
            consolePending.clear()
          })
        )
        // A service set or removed from the console: the Cloud hears which services this home reaches now.
        const changes = yield* settings.changes
        yield* Effect.forkScoped(Effect.forever(Effect.gen(function*() {
          yield* PubSub.take(changes)
          if (!(yield* Ref.get(linked))) return
          yield* write(HomeProtocol.ServicesChanged.make({ services: configuredServices(yield* settings.current) }))
        })))

        const read = Effect.gen(function*() {
          while (true) {
            for (const frame of yield* pull) {
              const decoded = decodeCloudMessage(frame)
              if (decoded._tag === "None") {
                yield* Effect.logWarning("ignored a message from the cloud that isn't part of the protocol")
                continue
              }
              const message = decoded.value
              switch (message._tag) {
                case "Challenge":
                  yield* write(HomeProtocol.Proof.make({ signature: key.sign(message.nonce) }))
                  break
                case "Welcome":
                  if (message.homeId !== key.homeId) {
                    yield* Effect.logWarning(`the cloud welcomed home ${message.homeId}, this is ${key.homeId}`)
                  }
                  yield* Effect.logInfo(`linked as home ${key.homeId}`)
                  yield* Ref.set(failures, 0)
                  yield* gate.withPermit(Effect.gen(function*() {
                    yield* Ref.set(linked, true)
                    if (held.length > 0) {
                      yield* Effect.logInfo(`sending ${held.length} message(s) held while the link was down`)
                    }
                    for (const message of held.splice(0)) yield* write(message)
                  }))
                  // On disk, without holding up the link.
                  yield* Effect.forkDetach(cloudSeen.linked)
                  yield* watcher.reset
                  // Quai Home's own journal lines, for the Cloud's live view: they're kept here already.
                  yield* Effect.forkScoped(
                    Effect.forever(
                      Effect.flatMap(journal.noted, (entries) => write(HomeProtocol.JournalNoted.make({ entries })))
                    )
                  )
                  break
                case "Refused":
                  return {
                    _tag: "Refused",
                    reason: message.reason,
                    retryAfterSeconds: message.retryAfterSeconds
                  } satisfies Outcome
                case "Ping":
                  yield* Ref.set(lastPing, yield* Clock.currentTimeMillis)
                  yield* write(HomeProtocol.Pong.make({ at: message.at }))
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
                // In memory, so in the order sent: a read after an append sees it.
                case "JournalAppend":
                  yield* journal.append(message.entries)
                  break
                case "ConsoleResponse": {
                  const answer = consolePending.get(message.id)
                  if (answer !== undefined) {
                    consolePending.delete(message.id)
                    yield* Deferred.succeed(answer, message)
                  }
                  break
                }
                case "JournalRead": {
                  const page = yield* journal.read(message.query)
                  yield* write(
                    HomeProtocol.JournalPage.make({ id: message.id, entries: page.entries, more: page.more })
                  )
                  break
                }
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
        Effect.catchTag(
          "SocketError",
          (error) => Effect.succeed({ _tag: "Closed", reason: error.message } satisfies Outcome)
        )
      )

      const loop = Effect.gen(function*() {
        while (true) {
          const outcome: Outcome = yield* connection
          if (outcome._tag === "Refused") {
            const seconds = Math.max(1, outcome.retryAfterSeconds)
            yield* Effect.logWarning(`the cloud refused this home: ${outcome.reason}. Trying again in ${seconds} s`)
            yield* Ref.set(failures, 0)
            yield* Effect.sleep(`${seconds} seconds`)
          } else {
            yield* Effect.logInfo(`link to the cloud down: ${outcome.reason}`)
            yield* Effect.sleep(reconnectDelayMs(yield* Ref.getAndUpdate(failures, (count) => count + 1)))
          }
        }
      })
      yield* Effect.forkScoped(loop)

      return {
        linked: Ref.get(linked),
        console: (request) =>
          Effect.gen(function*() {
            const write = yield* Ref.get(current)
            if (write === null || !(yield* Ref.get(linked))) {
              return yield* Effect.fail(new CloudUnreachable({ message: notLinkedMessage }))
            }
            const id = `c${yield* Ref.updateAndGet(consoleCount, (count) => count + 1)}`
            const answer = yield* Deferred.make<HomeProtocol.ConsoleResponse, CloudUnreachable>()
            consolePending.set(id, answer)
            yield* write(HomeProtocol.ConsoleRequest.make({ ...request, id }))
            const response = yield* Deferred.await(answer).pipe(
              Effect.timeoutOrElse({
                duration: consoleRequestTimeoutMs,
                orElse: () => Effect.fail(new CloudUnreachable({ message: "Quai Cloud didn't answer in time" }))
              }),
              Effect.ensuring(Effect.sync(() => consolePending.delete(id)))
            )
            return { status: response.status, body: response.body }
          }),
        send: (message) =>
          gate.withPermit(Effect.gen(function*() {
            const write = yield* Ref.get(current)
            if (write !== null && (yield* Ref.get(linked))) return yield* write(message)
            held.push(message)
            if (held.length > heldWebhooksLimit) held.shift()
            yield* Effect.logDebug(`not linked: holding ${message._tag}`)
          }))
      }
    })
  )
}
