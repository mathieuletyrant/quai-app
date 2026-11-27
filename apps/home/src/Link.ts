import { HomeProtocol } from "@quai/api"
import type { RelayedAnswer } from "@quai/domain/home/ConsoleRelay.ts"
import { ApnsError, type ApnsRequest } from "@quai/domain/push/Apns.ts"
import { Clock, Context, Deferred, Effect, Layer, PubSub, Ref, Schema, type Scope, Semaphore } from "effect"
import { Socket } from "effect/socket"
import { CloudSeen } from "./CloudSeen.ts"
import { configuredServices, HomeConfig } from "./Config.ts"
import { HomeKey } from "./HomeKey.ts"
import { Journal } from "./Journal.ts"
import { LocalHome, startingMessage } from "./LocalHome.ts"
import { ServiceSettings } from "./ServiceSettings.ts"
import { homeVersion } from "./Version.ts"

type HomeMessage = HomeProtocol.HomeMessage
type CloudMessageOf<Tag extends HomeProtocol.CloudMessage["_tag"]> = Extract<
  HomeProtocol.CloudMessage,
  { readonly _tag: Tag }
>

const HomeJson = Schema.fromJsonString(HomeProtocol.HomeMessage)
const CloudJson = Schema.fromJsonString(HomeProtocol.CloudMessage)

/** Reads a frame from the cloud; anything we can't read is None. */
export const decodeCloudMessage = Schema.decodeUnknownOption(CloudJson)

/** Wait before reconnecting: 1 s doubling to 1 min. A Welcome starts over from 1 s. */
export const reconnectDelayMs = (failures: number) => Math.min(1_000 * 2 ** failures, 60_000)

/** The cloud pings every 20 s: this long without one, the link is dead even if the socket isn't closed. */
export const heartbeatTimeoutMs = 60_000

/** How long a push waits for Quai Cloud to say what APNs answered (APNs itself gets 10 s there). */
export const pushTimeoutMs = 15_000

/**
 * The link down this long is said in the journal, and its return after that: the hosted Cloud's
 * drops of a few seconds, several times a day, are not.
 */
export const unreachableAfterMs = 60_000

/** Why a push didn't go, when it never reached APNs. */
export const notLinkedMessage = "Quai Cloud isn't reachable"
export const noCloudMessage = "No Quai Cloud is set: set QUAI_CLOUD_URL on Quai Home"

/** One of the app's requests, as Quai Cloud relays it, and what answers it: the home's own routes. */
export type AppRequest = Omit<HomeProtocol.AppRequest, "_tag" | "id">
export type AppHandler = (request: AppRequest) => Effect.Effect<RelayedAnswer>

/** The app's requests answered at once; the others wait their turn. */
const appConcurrency = 8

type Outcome =
  | { readonly _tag: "Closed"; readonly reason: string }
  | { readonly _tag: "Refused"; readonly reason: string; readonly retryAfterSeconds: number }

const unsent = (reason: string) => new ApnsError({ status: null, reason, tokenGone: false })

/**
 * The one WebSocket to Quai Cloud. Quai Home runs Quai for its home (ADR 3): over the link it only
 * proves the home key, answers the app's requests the Cloud relays, asks the Cloud to send its
 * pushes, and says which pairing codes are open. It reconnects on its own.
 */
export class Link extends Context.Service<Link, {
  /** Whether the cloud welcomed this connection. */
  readonly linked: Effect.Effect<boolean>
  /** What the Cloud last said of itself in its Welcome: its push key's settings, its public access. */
  readonly welcome: () => HomeProtocol.Welcome | null
  /** Has Quai Cloud send one push to APNs. Fails, as APNs would, when it can't be reached or refuses. */
  readonly push: (request: ApnsRequest) => Effect.Effect<void, ApnsError>
  /** Answers the app's requests the Cloud relays. Until set, 503. */
  readonly answerApp: (handler: AppHandler) => Effect.Effect<void>
}>()("quai-home/Link") {
  /** No `QUAI_CLOUD_URL`: nothing to link to. Quai Home runs alone: no app from outside, no push. */
  static readonly unlinked = Layer.succeed(Link, {
    linked: Effect.succeed(false),
    welcome: () => null,
    push: () => Effect.fail(unsent(noCloudMessage)),
    answerApp: () => Effect.void
  })

  static readonly layer = Layer.effect(
    Link,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const settings = yield* ServiceSettings
      const cloudSeen = yield* CloudSeen
      const key = yield* HomeKey
      const local = yield* LocalHome
      const journal = yield* Journal
      const socket = yield* Socket.Socket
      const current = yield* Ref.make<((message: HomeMessage) => Effect.Effect<void>) | null>(null)
      const linked = yield* Ref.make(false)
      const failures = yield* Ref.make(0)
      const pushCount = yield* Ref.make(0)
      const appHandler = yield* Ref.make<AppHandler | null>(null)
      let welcome: HomeProtocol.Welcome | null = null
      /** Why the Cloud last refused this home: said once in the journal, not at every try. */
      let refusedFor: string | null = null
      /** Since when the link is down, and whether the journal said so. */
      let downSince: number | null = null
      let saidUnreachable = false
      /** The pushes waiting for the Cloud's answer, on the current connection. */
      const pushes = new Map<string, Deferred.Deferred<HomeProtocol.PushResponse, ApnsError>>()

      const hello = Effect.map(settings.current, (endpoints) =>
        HomeProtocol.Hello.make({
          protocol: HomeProtocol.protocolVersion,
          homeVersion,
          publicKey: key.publicKey,
          services: configuredServices(endpoints),
          webUrls: config.webUrls
        }))

      const connection = Effect.gen(function*() {
        const pull = yield* Socket.readerString(socket)
        const writer = yield* socket.writer
        const write = (message: HomeMessage) =>
          Schema.encodeEffect(HomeJson)(message).pipe(
            Effect.flatMap(writer.write),
            Effect.catch((error) => Effect.logWarning(`could not send ${message._tag}`, error))
          )
        const semaphore = yield* Semaphore.make(appConcurrency)
        const lastPing = yield* Ref.make(yield* Clock.currentTimeMillis)

        yield* write(yield* hello)
        yield* Ref.set(current, write)
        yield* Effect.addFinalizer(() =>
          Effect.gen(function*() {
            yield* Ref.set(current, null)
            yield* Ref.set(linked, false)
            for (const answer of pushes.values()) yield* Deferred.fail(answer, unsent(notLinkedMessage))
            pushes.clear()
          })
        )
        // A service set or removed from the console: the Cloud hears which services this home reaches now.
        const changes = yield* settings.changes
        yield* Effect.forkScoped(Effect.forever(Effect.gen(function*() {
          yield* PubSub.take(changes)
          if (!(yield* Ref.get(linked))) return
          yield* write(HomeProtocol.ServicesChanged.make({ services: configuredServices(yield* settings.current) }))
        })))

        /** What this connection last told the Cloud of the pairing codes: said again only when it changed. */
        let told: string | null = null
        const pairingCodes = Effect.flatMap(local.pairingHashes, (open) => {
          const hashes = open.slice(0, HomeProtocol.maxPairingCodes)
          if (told === hashes.join()) return Effect.void
          told = hashes.join()
          return write(HomeProtocol.PairingCodes.make({ hashes }))
        })

        /** The Cloud welcomed this home: it hears the open pairing codes, now and as they change. */
        const welcomed = (message: CloudMessageOf<"Welcome">) =>
          Effect.gen(function*() {
            if (message.homeId !== key.homeId) {
              yield* Effect.logWarning(`the cloud welcomed home ${message.homeId}, this is ${key.homeId}`)
            }
            yield* Effect.logInfo(`linked as home ${key.homeId}`)
            welcome = message
            refusedFor = null
            yield* reachable
            yield* Ref.set(failures, 0)
            yield* Ref.set(linked, true)
            // On disk, without holding up the link.
            yield* Effect.forkDetach(cloudSeen.linked)
            yield* pairingCodes
            yield* Effect.forkScoped(Effect.forever(Effect.andThen(local.pairingChanged, pairingCodes)))
          })

        /** One of the app's requests: answered by the home's routes, a few at a time. */
        const answerApp = (message: CloudMessageOf<"AppRequest">) =>
          Effect.gen(function*() {
            const { _tag, id, ...request } = message
            const handler = yield* Ref.get(appHandler)
            const answer: RelayedAnswer = handler === null || !HomeProtocol.isAppPath(request.path)
              ? handler === null
                ? { status: 503, body: JSON.stringify({ _tag: "HomeOffline", message: startingMessage }) }
                : { status: 404, body: "" }
              : yield* handler(request)
            yield* write(HomeProtocol.AppResponse.make({ id, ...answer }))
          })

        /** What APNs answered a push still waiting on this connection. */
        const pushed = (message: CloudMessageOf<"PushResponse">) =>
          Effect.suspend(() => {
            const answer = pushes.get(message.id)
            if (answer === undefined) return Effect.void
            pushes.delete(message.id)
            return Deferred.succeed(answer, message)
          })

        /** One message from the Cloud that keeps the connection going. */
        const handle = (
          message: Exclude<HomeProtocol.CloudMessage, CloudMessageOf<"Refused">>
        ): Effect.Effect<unknown, never, Scope.Scope> => {
          switch (message._tag) {
            case "Challenge":
              return write(HomeProtocol.Proof.make({ signature: key.sign(message.nonce) }))
            case "Welcome":
              return welcomed(message)
            case "Ping":
              return Effect.flatMap(
                Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(lastPing, now)),
                () => write(HomeProtocol.Pong.make({ at: message.at }))
              )
            case "AppRequest":
              return Effect.asVoid(Effect.forkScoped(semaphore.withPermit(answerApp(message))))
            case "PushResponse":
              return pushed(message)
            // What a Cloud asks a Quai Home that doesn't run Quai: this one does, and answers none of it.
            case "Call":
            case "StoreList":
            case "StorePut":
            case "StoreDelete":
            case "JournalRead":
              return write(HomeProtocol.Failed.make({ id: message.id, reason: "this Quai Home runs Quai itself" }))
            case "SetWatches":
            case "JournalAppend":
            case "ConsoleResponse":
              return Effect.void
          }
        }

        /**
         * One frame from the Cloud; an outcome only when the Cloud refused this home. Anything not part of the
         * protocol is logged and left.
         */
        const receive = (frame: string): Effect.Effect<Outcome | undefined, never, Scope.Scope> => {
          const decoded = decodeCloudMessage(frame)
          if (decoded._tag === "None") {
            return Effect.as(
              Effect.logWarning("ignored a message from the cloud that isn't part of the protocol"),
              undefined
            )
          }
          const message = decoded.value
          if (message._tag === "Refused") {
            return Effect.succeed(
              {
                _tag: "Refused",
                reason: message.reason,
                retryAfterSeconds: message.retryAfterSeconds
              } satisfies Outcome
            )
          }
          // What a handler yields is never an outcome: `Deferred.succeed`'s `true` once closed the link.
          return Effect.as(handle(message), undefined)
        }

        const read = Effect.gen(function*() {
          while (true) {
            for (const frame of yield* pull) {
              const outcome = yield* receive(frame)
              if (outcome !== undefined) return outcome
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

      /** A refusal goes to the journal once per reason: a Cloud too old for this Quai Home says so there. */
      const refused = (reason: string) =>
        Effect.suspend(() => {
          if (refusedFor === reason) return Effect.void
          refusedFor = reason
          return journal.note({
            level: "warn",
            source: "cloud",
            kind: "cloud.refused",
            text: `Quai Cloud refused this Quai Home: ${reason}`
          })
        })

      /** Linked again: the journal says so when it said the Cloud was out of reach. */
      const reachable = Effect.suspend(() => {
        downSince = null
        if (!saidUnreachable) return Effect.void
        saidUnreachable = false
        return journal.note({
          level: "info",
          source: "cloud",
          kind: "cloud.reachable",
          text: "Quai Cloud is reachable again"
        })
      })

      /** Still not linked: once it has lasted `unreachableAfterMs`, the journal says what that means. */
      const unreachable = Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        downSince ??= now
        if (saidUnreachable || now - downSince < unreachableAfterMs) return
        saidUnreachable = true
        yield* journal.note({
          level: "warn",
          source: "cloud",
          kind: "cloud.unreachable",
          text: "Quai Cloud isn't reachable: the app can't reach this home from outside, and nothing is pushed"
        })
      })

      const loop = Effect.gen(function*() {
        while (true) {
          const outcome: Outcome = yield* connection
          yield* unreachable
          if (outcome._tag === "Refused") {
            const seconds = Math.max(1, outcome.retryAfterSeconds)
            yield* Effect.logWarning(`the cloud refused this home: ${outcome.reason}. Trying again in ${seconds} s`)
            yield* refused(outcome.reason)
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
        welcome: () => welcome,
        answerApp: (handler) => Ref.set(appHandler, handler),
        push: (request) =>
          Effect.gen(function*() {
            const write = yield* Ref.get(current)
            if (write === null || !(yield* Ref.get(linked))) return yield* Effect.fail(unsent(notLinkedMessage))
            const id = `p${yield* Ref.updateAndGet(pushCount, (count) => count + 1)}`
            const answer = yield* Deferred.make<HomeProtocol.PushResponse, ApnsError>()
            pushes.set(id, answer)
            yield* write(
              HomeProtocol.PushRequest.make({ ...request, id, body: request.body as Record<string, unknown> })
            )
            const response = yield* Deferred.await(answer).pipe(
              Effect.timeoutOrElse({
                duration: pushTimeoutMs,
                orElse: () => Effect.fail(unsent("Quai Cloud didn't answer in time"))
              }),
              Effect.ensuring(Effect.sync(() => pushes.delete(id)))
            )
            if (response.error !== undefined) return yield* Effect.fail(new ApnsError(response.error))
          })
      }
    })
  )
}
