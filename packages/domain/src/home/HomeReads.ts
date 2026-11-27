import { HomeOffline, type HomeProtocol, journalSourceNames } from "@quai/api"
import { Clock, Context, Deferred, Effect, Exit, Layer, Option, Schema } from "effect"
import { readJson } from "../integrations/Integration.ts"
import { Journal } from "../journal/Journal.ts"
import { type CallRequest, HomeLink, offlineMessage, toOffline } from "./HomeLink.ts"

/** One GET to a service through Quai Home, and the schema of its body. */
export interface Read<A> {
  readonly service: HomeProtocol.HomeService
  /** Path and query. */
  readonly path: string
  readonly schema: Schema.Codec<A, unknown>
  /** What a 404 means, when it means something (a request deleted). Otherwise a 404 is None. */
  readonly notFound?: A
}

type Reads = Readonly<Record<string, Read<unknown> | null>>
// Distributive over `Read | null`: a read that may be skipped is an Option of its value all the same.
type ValueOf<T> = T extends Read<infer A> ? Option.Option<A> : Option.Option<never>
type ServiceOfRead<T> = T extends Read<unknown> ? T["service"] : never
type Values<R extends Reads> = { readonly [K in keyof R]: ValueOf<R[K]> }
type ServiceOf<R extends Reads> = { [K in keyof R]: ServiceOfRead<R[K]> }[keyof R]

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined

/**
 * The error message of a failed call, in the service's words: `[{ errorMessage }]` (an *arr's
 * validation), `{ message }`, `{ detail }` (Reclaimerr), or the body itself when it's short.
 */
export const serviceError = (status: number, body: string): string => {
  const parsed = decodeJson(body)
  if (parsed._tag === "Some") {
    const value = parsed.value
    const candidates = [
      Array.isArray(value) ? field(value[0], "errorMessage") : undefined,
      field(value, "message"),
      field(value, "detail"),
      field(value, "error")
    ]
    const found = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate !== "")
    if (found !== undefined) return found
  }
  const text = body.trim()
  return text !== "" && text.length <= 200 && !text.startsWith("<") ? text : `HTTP ${status}`
}

/** What came back from a call: the service's answer, or why Quai Home couldn't get one (not offline). */
type Outcome =
  | { readonly _tag: "Answered"; readonly status: number; readonly body: string }
  | { readonly _tag: "Failed"; readonly message: string }

const isSuccess = (status: number) => status >= 200 && status < 300

/**
 * How long a GET's 2xx answer serves the reads that ask for it again, unless they say otherwise
 * (`AnswersKeptFor`). A screen's routes are asked together and read the same lists (the movies,
 * the queues, the strikes): one call answers them all. Short, for what acts on what it reads: an
 * action, a flow.
 */
export const answerKeptMs = 5_000

/**
 * How long a kept answer serves the app's screens (its GETs): opened again, or another tab opened,
 * within the minute, a screen reads nothing again. What the stack says it changed meanwhile isn't
 * kept: a service's webhook forgets its answers, a write forgets them all.
 */
export const screenAnswerKeptMs = 60_000

/**
 * How old a kept answer may be for whoever reads now. `answerKeptMs` unless the reader allows
 * more, as the app's screens do (`DeviceAuthLive`).
 */
export const AnswersKeptFor = Context.Reference<number>("quai/AnswersKeptFor", {
  defaultValue: () => answerKeptMs
})

/** A GET on its way (`at` null), or answered at `at` and kept. */
interface KeptGet<A> {
  readonly service: HomeProtocol.HomeService
  readonly answer: A
  at: number | null
}

/**
 * The GETs on their way and their 2xx answers, by service and path, each kept `keptMs` at most.
 * One reader may take an answer another finds too old: how old is the reader's to say.
 */
export const makeKeptGets = <A>(keptMs: number = screenAnswerKeptMs) => {
  const gets = new Map<string, KeptGet<A>>()
  const keyOf = (service: HomeProtocol.HomeService, path: string) => `${service} ${path}`
  return {
    /** The GET on its way, or its answer when it is at most `maxAgeMs` old. */
    find: (service: HomeProtocol.HomeService, path: string, now: number, maxAgeMs: number): A | undefined => {
      const found = gets.get(keyOf(service, path))
      return found !== undefined && (found.at === null || now - found.at < maxAgeMs) ? found.answer : undefined
    },
    /**
     * A GET leaves: until it settles, every reader waits for it. What is too old to serve anyone
     * goes. Gives what to call when it came back: kept from then when `keep`, forgotten otherwise
     * (nothing, if another GET of the same took its place meanwhile).
     */
    begin: (service: HomeProtocol.HomeService, path: string, answer: A, now: number) => {
      for (const [key, kept] of gets) if (kept.at !== null && now - kept.at >= keptMs) gets.delete(key)
      const key = keyOf(service, path)
      const leaving: KeptGet<A> = { service, answer, at: null }
      gets.set(key, leaving)
      return (settledAt: number, keep: boolean) => {
        if (gets.get(key) !== leaving) return
        if (keep) leaving.at = settledAt
        else gets.delete(key)
      }
    },
    /** Forgets a service's answers, or every answer. */
    forget: (service?: HomeProtocol.HomeService) => {
      for (const [key, kept] of gets) if (service === undefined || kept.service === service) gets.delete(key)
    },
    size: () => gets.size
  }
}

/** What a read's outcome holds: its value, the read's `notFound` for a 404 that has one, else None. */
const valueOf = <A>(spec: Read<A>, outcome: Outcome): Option.Option<A> => {
  if (outcome._tag === "Failed") return Option.none()
  if (outcome.status === 404 && spec.notFound !== undefined) return Option.some(spec.notFound)
  return isSuccess(outcome.status) ? readJson(spec.schema, outcome.body) : Option.none()
}

/** Why a read gave nothing, in words for the log and the service's health. */
const whyUnread = (outcome: Outcome) => {
  if (outcome._tag === "Failed") return outcome.message
  return isSuccess(outcome.status) ? "an answer Quai can't read" : `HTTP ${outcome.status}`
}

/** A 4xx says the service is there: what was asked isn't. Anything else counts against its health. */
const countsAgainstService = (outcome: Outcome) =>
  outcome._tag === "Failed" || outcome.status >= 500 || outcome.status < 300

/**
 * The calls Quai Cloud makes to the home's services through Quai Home, one policy for all: Quai
 * Home gone, or never there, is `HomeOffline` (503); a service that didn't answer as expected is
 * None for a read, logged once with its service and path (never what it answered), and a refusal
 * in words for a write. The journal gets a line when a service stops answering the reads (no
 * answer, a 5xx, a body Quai can't read; not a 404) and one when it answers again. Reads of the
 * same GET at once share one call, and its 2xx answer serves those that follow for as long as each
 * allows (`AnswersKeptFor`: `answerKeptMs`, a minute for the app's screens); a write forgets every
 * answer kept, and a service's webhook its own (`forget`), so what changed is read again.
 */
export class HomeReads extends Context.Service<HomeReads, {
  /** The services the connected Quai Home reaches. */
  readonly services: Effect.Effect<ReadonlyArray<HomeProtocol.HomeService>, HomeOffline>
  /** The protocol the connected Quai Home speaks: which calls it lets through. */
  readonly protocol: Effect.Effect<number, HomeOffline>
  /** Where an iPhone opens Radarr and Sonarr, as the connected Quai Home gave them. */
  readonly webUrls: Effect.Effect<HomeProtocol.WebUrls, HomeOffline>
  /**
   * A GET's body. None when Quai Home didn't get an answer in time or refused the call, when the
   * service answered other than 2xx, or with a body that doesn't decode.
   */
  readonly read: <A>(read: Read<A>) => Effect.Effect<Option.Option<A>, HomeOffline>
  /**
   * Several reads at once. A read set to `null`, or to a service Quai Home doesn't reach, is
   * skipped (None). `unavailable` lists, in the order of the reads, the services reached with a
   * read that came back None, but for the `optional` reads (a disk, a queue).
   */
  readonly all: <R extends Reads>(
    reads: R,
    options?: { readonly optional?: ReadonlyArray<keyof R> }
  ) => Effect.Effect<{ readonly values: Values<R>; readonly unavailable: ReadonlyArray<ServiceOf<R>> }, HomeOffline>
  /**
   * A call that must succeed: the body of its 2xx answer. Otherwise `refused`, with why in words:
   * Quai Home's (`Quai Home: timed out`), or the service's own when it gives some.
   */
  readonly write: <E>(
    call: CallRequest,
    refused: (message: string) => E,
    options?: { readonly timeoutMs?: number }
  ) => Effect.Effect<string, HomeOffline | E>
  /** Forgets the answers kept of a service: it said something changed (a webhook). */
  readonly forget: (service: HomeProtocol.HomeService) => Effect.Effect<void>
}>()("quai/HomeReads") {
  static readonly layer = Layer.effect(
    HomeReads,
    Effect.gen(function*() {
      const link = yield* HomeLink
      const journal = yield* Journal
      /** The services whose last read failed. */
      const failing = new Set<HomeProtocol.HomeService>()
      const observed = (
        service: HomeProtocol.HomeService,
        failed: { readonly why: string; readonly path: string } | null
      ) =>
        Effect.suspend(() => {
          const name = journalSourceNames[service]
          if (failed === null) {
            return failing.delete(service)
              ? journal.log({
                level: "info",
                source: service,
                kind: "service.available",
                text: `${name} answers Quai again`
              })
              : Effect.void
          }
          if (failing.has(service)) return Effect.void
          failing.add(service)
          return journal.log({
            level: "warn",
            source: service,
            kind: "service.unavailable",
            text: `${name} didn't answer Quai: ${failed.why} (${failed.path})`
          })
        })

      const call = (
        request: CallRequest,
        options?: { readonly timeoutMs?: number }
      ): Effect.Effect<Outcome, HomeOffline> =>
        link.call(request, options).pipe(
          Effect.map((response): Outcome => ({ _tag: "Answered", ...response })),
          Effect.catchTag("HomeError", (error) =>
            error.reason === "offline"
              ? Effect.fail(toOffline(error))
              : Effect.succeed<Outcome>({ _tag: "Failed", message: error.message }))
        )

      const scope = yield* Effect.scope
      const gets = makeKeptGets<Deferred.Deferred<Outcome, HomeOffline>>()

      /**
       * A GET's outcome, from the call already on its way, or from its last answer when the reader
       * finds it recent enough. The call runs on its own: a read given up (an iPhone that stopped
       * waiting) leaves it to the others. A 2xx answer is kept; anything else is forgotten.
       */
      const get = (service: HomeProtocol.HomeService, path: string) =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const found = gets.find(service, path, now, yield* AnswersKeptFor)
          if (found !== undefined) return yield* Deferred.await(found)
          const answer = yield* Deferred.make<Outcome, HomeOffline>()
          const settle = gets.begin(service, path, answer, now)
          yield* Effect.forkIn(
            Effect.gen(function*() {
              const exit = yield* Effect.exit(call({ service, method: "GET", path }))
              const keep = Exit.isSuccess(exit) && exit.value._tag === "Answered" && isSuccess(exit.value.status)
              settle(yield* Clock.currentTimeMillis, keep)
              yield* Deferred.done(answer, exit)
            }),
            scope
          )
          return yield* Deferred.await(answer)
        })

      const services = Effect.flatMap(
        link.home,
        (home) =>
          Option.isSome(home)
            ? Effect.succeed(home.value.services)
            : Effect.fail(new HomeOffline({ message: offlineMessage }))
      )

      const protocol = Effect.flatMap(
        link.home,
        (home) =>
          Option.isSome(home)
            ? Effect.succeed(home.value.protocol)
            : Effect.fail(new HomeOffline({ message: offlineMessage }))
      )
      const webUrls = Effect.flatMap(
        link.home,
        (home) =>
          Option.isSome(home)
            ? Effect.succeed(home.value.webUrls ?? {})
            : Effect.fail(new HomeOffline({ message: offlineMessage }))
      )

      const read = <A>(spec: Read<A>) =>
        Effect.gen(function*() {
          const answer = yield* get(spec.service, spec.path)
          const value = valueOf(spec, answer)
          if (Option.isSome(value)) {
            yield* observed(spec.service, null)
          } else {
            const path = spec.path.split("?")[0]!
            const why = whyUnread(answer)
            yield* Effect.logWarning(`${spec.service} ${path}: ${why}`)
            if (countsAgainstService(answer)) yield* observed(spec.service, { why, path })
          }
          return value
        })

      const all = <R extends Reads>(reads: R, options?: { readonly optional?: ReadonlyArray<keyof R> }) =>
        Effect.gen(function*() {
          const reached = yield* services
          const asked = Object.entries(reads).flatMap(([key, spec]) =>
            spec !== null && reached.includes(spec.service) ? [[key, spec] as const] : []
          )
          const results = yield* Effect.forEach(
            asked,
            ([key, spec]) => Effect.map(read(spec), (value) => [key, spec.service, value] as const),
            {
              concurrency: "unbounded"
            }
          )
          const unavailable: Array<ServiceOf<R>> = []
          for (const [key, service, value] of results) {
            if (
              Option.isNone(value) && options?.optional?.includes(key) !== true &&
              !unavailable.includes(service as ServiceOf<R>)
            ) {
              unavailable.push(service as ServiceOf<R>)
            }
          }
          const found = new Map(results.map(([key, , value]) => [key, value]))
          const values = Object.fromEntries(Object.keys(reads).map((key) => [key, found.get(key) ?? Option.none()]))
          return { values: values as Values<R>, unavailable }
        })

      /** A write: what was kept before it, or read while it ran, may be what it changes. */
      const forgetting = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.suspend(() => {
          gets.forget()
          return Effect.ensuring(effect, Effect.sync(() => gets.forget()))
        })

      const write = <E>(
        request: CallRequest,
        refused: (message: string) => E,
        options?: { readonly timeoutMs?: number }
      ) =>
        Effect.flatMap(
          forgetting(call(request, options)),
          (answer): Effect.Effect<string, E> =>
            answer._tag === "Failed"
              ? Effect.fail(refused(`Quai Home: ${answer.message}`))
              : answer.status >= 200 && answer.status < 300
              ? Effect.succeed(answer.body)
              : Effect.fail(refused(serviceError(answer.status, answer.body)))
        )

      const forget = (service: HomeProtocol.HomeService) => Effect.sync(() => gets.forget(service))

      return { services, protocol, webUrls, read, all, write, forget } satisfies HomeReads["Service"]
    })
  )
}
