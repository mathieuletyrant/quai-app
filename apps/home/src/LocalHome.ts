import type { Service } from "@quai/api"
import type { RelayedAnswer } from "@quai/domain/home/ConsoleRelay.ts"
import {
  type ConsoleHandler,
  type ConsoleRequest,
  HomeError,
  type HomeEvent,
  type HomeLink,
  type LinkedHome,
  makeDocuments
} from "@quai/domain/home/HomeLink.ts"
import { Clock, Context, Effect, Layer, Option, PubSub, Queue, Ref, Schema } from "effect"
import { Calls } from "./Calls.ts"
import { configuredServices, HomeConfig } from "./Config.ts"
import { HomeKey } from "./HomeKey.ts"
import { HomeStore } from "./HomeStore.ts"
import { Journal } from "./Journal.ts"
import { ServiceSettings } from "./ServiceSettings.ts"
import { Watches } from "./Watches.ts"

const pairingPrefix = "pairing/"
const decodePairing = Schema.decodeUnknownOption(Schema.Struct({ expiresAt: Schema.Number }))

/** What the console is told until the home's routes are up. */
export const startingMessage = "Quai Home is starting"

/** The pairing codes still open at `now`, by their hashes: the keys of their documents. */
export const openPairingHashes = (documents: ReadonlyMap<string, unknown>, now: number): ReadonlyArray<string> =>
  [...documents].flatMap(([key, value]) => {
    if (!key.startsWith(pairingPrefix)) return []
    const pairing = decodePairing(value)
    return Option.isSome(pairing) && pairing.value.expiresAt >= now ? [key.slice(pairingPrefix.length)] : []
  }).sort()

/**
 * The home, for the domain that runs in Quai Home (ADR 3): its home link answered in place. The
 * calls go to the services on the LAN (`Calls`, as many at once as are asked), the watches are polled here
 * (`Watches`), the documents are the home store's, the journal is Quai Home's own. Nothing crosses
 * a WebSocket: this home is never offline.
 */
export class LocalHome extends Context.Service<LocalHome, {
  /** The link the domain's services use. */
  readonly link: HomeLink["Service"]
  /** A webhook a service sent: an event for the domain. */
  readonly webhook: (service: Service, receivedAt: number, body: unknown) => Effect.Effect<void>
  /** One of the console's requests, answered by the domain's routes; 503 until they are up. */
  readonly console: (request: ConsoleRequest) => Effect.Effect<RelayedAnswer>
  /** The hashes of the pairing codes open now. */
  readonly pairingHashes: Effect.Effect<ReadonlyArray<string>>
  /** Waits for a pairing code to open or be spent. One reader: the link to Quai Cloud. */
  readonly pairingChanged: Effect.Effect<void>
}>()("quai-home/LocalHome") {
  static readonly layer = Layer.effect(
    LocalHome,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const key = yield* HomeKey
      const settings = yield* ServiceSettings
      const calls = yield* Calls
      const watches = yield* Watches
      const store = yield* HomeStore
      const journal = yield* Journal

      const events = yield* Queue.unbounded<HomeEvent>()
      const pairingChanges = yield* Queue.sliding<void>(1)
      const consoleHandler = yield* Ref.make<ConsoleHandler | null>(null)

      const failed = (error: { readonly message: string }) =>
        new HomeError({ reason: "failed", message: error.message })
      // Every document, read once: the store is this process's alone, so what is cached is what is on disk.
      const cached = new Map(
        (yield* Effect.orDie(store.list(""))).map((document) => [document.key, document.value])
      )
      const documents = makeDocuments(Effect.succeed(cached), (documentKey, value) =>
        Effect.gen(function*() {
          yield* Effect.mapError(
            value === undefined ? store.delete(documentKey) : store.put(documentKey, value),
            failed
          )
          if (value === undefined) cached.delete(documentKey)
          else cached.set(documentKey, value)
          if (documentKey.startsWith(pairingPrefix)) yield* Queue.offer(pairingChanges, undefined)
        }))

      const home = Effect.map(settings.current, (endpoints): LinkedHome => ({
        homeId: key.homeId,
        services: configuredServices(endpoints),
        webUrls: config.webUrls
      }))

      // What the watches read becomes the domain's events: a snapshot, or why a watch can't be.
      const watcher = yield* watches.make((event) => Queue.offer(events, event))

      yield* Queue.offer(events, { _tag: "Ready", home: yield* home })
      // A service set or removed from the console: the domain hears which services this home reaches now.
      const changes = yield* settings.changes
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            PubSub.take(changes),
            Effect.flatMap(home, (changed) => Queue.offer(events, { _tag: "Services", home: changed }))
          )
        )
      )
      // Quai Home's own journal lines, for the journal's live view: they're kept here already.
      yield* Effect.forkScoped(
        Effect.forever(Effect.flatMap(journal.noted, (entries) => Queue.offer(events, { _tag: "Journal", entries })))
      )

      const link: HomeLink["Service"] = {
        homeId: key.homeId,
        home: Effect.map(home, Option.some),
        call: (request, options) =>
          Effect.flatMap(calls.run(request, options), (answer) =>
            answer._tag === "Failed"
              ? Effect.fail(new HomeError({ reason: "failed", message: answer.reason }))
              : Effect.succeed({ status: answer.status, body: answer.body })),
        setWatches: (list) => watcher.set(list),
        appendJournal: (entries) => journal.append(entries),
        readJournal: (query) => journal.read(query),
        documents: { homeId: key.homeId, ...documents },
        nextEvent: Queue.take(events),
        answerConsole: (handler) => Ref.set(consoleHandler, handler)
      }

      return {
        link,
        webhook: (service, receivedAt, body) =>
          Effect.asVoid(Queue.offer(events, { _tag: "Webhook", service, receivedAt, body })),
        console: (request) =>
          Effect.flatMap(Ref.get(consoleHandler), (handler) =>
            handler === null
              ? Effect.succeed({
                status: 503,
                body: JSON.stringify({ _tag: "HomeOffline", message: startingMessage })
              })
              : handler(request)),
        pairingHashes: Effect.map(Clock.currentTimeMillis, (now) => openPairingHashes(cached, now)),
        pairingChanged: Queue.take(pairingChanges)
      }
    })
  )
}
