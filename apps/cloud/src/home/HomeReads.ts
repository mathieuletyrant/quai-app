import { HomeOffline, type HomeProtocol } from "@quai/api"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { readJson } from "../integrations/Integration.ts"
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
type Values<R extends Reads> = { readonly [K in keyof R]: R[K] extends Read<infer A> ? Option.Option<A> : Option.Option<never> }
type ServiceOf<R extends Reads> = { [K in keyof R]: R[K] extends Read<unknown> ? R[K]["service"] : never }[keyof R]

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined

/**
 * The error message of a failed call, in the service's words: `[{ errorMessage }]` (an *arr's
 * validation), `{ message }`, `{ detail }` (Reclaimerr), or the body itself when it's short.
 */
export const serviceError = (status: number, body: string): string => {
  const parsed = decodeJson(body)
  if (parsed._tag === "Some") {
    const value = parsed.value
    const candidates = [Array.isArray(value) ? field(value[0], "errorMessage") : undefined, field(value, "message"), field(value, "detail"), field(value, "error")]
    const found = candidates.find((c): c is string => typeof c === "string" && c !== "")
    if (found !== undefined) return found
  }
  const text = body.trim()
  return text !== "" && text.length <= 200 && !text.startsWith("<") ? text : `HTTP ${status}`
}

/** What came back from a call: the service's answer, or why Quai Home couldn't get one (not offline). */
type Outcome =
  | { readonly _tag: "Answered"; readonly status: number; readonly body: string }
  | { readonly _tag: "Failed"; readonly message: string }

/**
 * The calls Quai Cloud makes to the home's services through Quai Home, one policy for all: Quai
 * Home gone, or never there, is `HomeOffline` (503); a service that didn't answer as expected is
 * None for a read, logged once with its service and path (never what it answered), and a refusal
 * in words for a write.
 */
export class HomeReads extends Context.Service<HomeReads, {
  /** The services the connected Quai Home reaches. */
  readonly services: Effect.Effect<ReadonlyArray<HomeProtocol.HomeService>, HomeOffline>
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

      const call = (request: CallRequest, options?: { readonly timeoutMs?: number }): Effect.Effect<Outcome, HomeOffline> =>
        link.call(request, options).pipe(
          Effect.map((response): Outcome => ({ _tag: "Answered", ...response })),
          Effect.catchTag("HomeError", (error) =>
            error.reason === "offline" ? Effect.fail(toOffline(error)) : Effect.succeed<Outcome>({ _tag: "Failed", message: error.message }))
        )

      const services = Effect.flatMap(link.home, (home) =>
        Option.isSome(home) ? Effect.succeed(home.value.services) : Effect.fail(new HomeOffline({ message: offlineMessage })))

      const read = <A>(r: Read<A>) =>
        Effect.gen(function*() {
          const answer = yield* call({ service: r.service, method: "GET", path: r.path })
          const value = answer._tag === "Failed"
            ? Option.none<A>()
            : answer.status === 404 && r.notFound !== undefined
            ? Option.some(r.notFound)
            : answer.status >= 200 && answer.status < 300
            ? readJson(r.schema, answer.body)
            : Option.none<A>()
          if (Option.isNone(value)) {
            const why = answer._tag === "Failed" ? answer.message : answer.status >= 200 && answer.status < 300 ? "an answer Quai can't read" : `HTTP ${answer.status}`
            yield* Effect.logWarning(`${r.service} ${r.path.split("?")[0]}: ${why}`)
          }
          return value
        })

      const all = <R extends Reads>(reads: R, options?: { readonly optional?: ReadonlyArray<keyof R> }) =>
        Effect.gen(function*() {
          const reached = yield* services
          const asked = Object.entries(reads).flatMap(([key, r]) => r !== null && reached.includes(r.service) ? [[key, r] as const] : [])
          const results = yield* Effect.forEach(asked, ([key, r]) => Effect.map(read(r), (value) => [key, r.service, value] as const), {
            concurrency: "unbounded"
          })
          const unavailable: Array<ServiceOf<R>> = []
          for (const [key, service, value] of results) {
            if (Option.isNone(value) && options?.optional?.includes(key) !== true && !unavailable.includes(service as ServiceOf<R>)) {
              unavailable.push(service as ServiceOf<R>)
            }
          }
          const found = new Map(results.map(([key, , value]) => [key, value]))
          const values = Object.fromEntries(Object.keys(reads).map((key) => [key, found.get(key) ?? Option.none()]))
          return { values: values as Values<R>, unavailable }
        })

      const write = <E>(request: CallRequest, refused: (message: string) => E, options?: { readonly timeoutMs?: number }) =>
        Effect.flatMap(call(request, options), (answer): Effect.Effect<string, E> =>
          answer._tag === "Failed"
            ? Effect.fail(refused(`Quai Home: ${answer.message}`))
            : answer.status >= 200 && answer.status < 300
            ? Effect.succeed(answer.body)
            : Effect.fail(refused(serviceError(answer.status, answer.body))))

      return { services, read, all, write } satisfies HomeReads["Service"]
    })
  )
}
