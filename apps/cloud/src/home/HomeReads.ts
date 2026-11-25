import { HomeOffline, type HomeProtocol, journalSourceNames } from "@quai/api"
import { Context, Effect, Layer, Option, Schema } from "effect"
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
 * answer, a 5xx, a body Quai can't read; not a 404) and one when it answers again.
 */
export class HomeReads extends Context.Service<HomeReads, {
  /** The services the connected Quai Home reaches. */
  readonly services: Effect.Effect<ReadonlyArray<HomeProtocol.HomeService>, HomeOffline>
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

      const services = Effect.flatMap(
        link.home,
        (home) =>
          Option.isSome(home)
            ? Effect.succeed(home.value.services)
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
          const answer = yield* call({ service: spec.service, method: "GET", path: spec.path })
          const value = valueOf(spec, answer)
          if (Option.isSome(value)) {
            yield* observed(spec.service, null)
            return value
          }
          const path = spec.path.split("?")[0]!
          const why = whyUnread(answer)
          yield* Effect.logWarning(`${spec.service} ${path}: ${why}`)
          if (countsAgainstService(answer)) yield* observed(spec.service, { why, path })
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

      const write = <E>(
        request: CallRequest,
        refused: (message: string) => E,
        options?: { readonly timeoutMs?: number }
      ) =>
        Effect.flatMap(call(request, options), (answer): Effect.Effect<string, E> =>
          answer._tag === "Failed"
            ? Effect.fail(refused(`Quai Home: ${answer.message}`))
            : answer.status >= 200 && answer.status < 300
            ? Effect.succeed(answer.body)
            : Effect.fail(refused(serviceError(answer.status, answer.body))))

      return { services, webUrls, read, all, write } satisfies HomeReads["Service"]
    })
  )
}
