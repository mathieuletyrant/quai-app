import { CurrentDevice, DeviceAuth, InvalidSignature, RequestSignature } from "@quai/api"
import { Clock, Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiError } from "effect/http-api"
import { Devices } from "../home/Devices.ts"
import { answerKeptMs, AnswersKeptFor, screenAnswerKeptMs } from "../home/HomeReads.ts"
import { makeNonces, problemMessages, signatureProblem } from "../home/RequestSignature.ts"

/** The request's body as it was sent, to check its signature; none for a GET. */
const bodyOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.method === "GET" || request.method === "HEAD"
    ? Effect.succeed("")
    : Effect.orElseSucceed(request.text, () => "")

/**
 * Checks the iPhone's token against the paired iPhones of the home (a hash, never the token), and,
 * for an iPhone paired with a device key, that it signed this request, now, and for the first time
 * (ADR 3): what carries the request, Quai Cloud, can't make one or play one again. An iPhone paired
 * without a key is known by its token alone, until it is paired again.
 */
export const DeviceAuthLive = Layer.effect(
  DeviceAuth,
  Effect.gen(function*() {
    const devices = yield* Devices
    const nonces = makeNonces()
    const signed = (deviceKey: string) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const problem = signatureProblem(
          deviceKey,
          {
            method: request.method,
            path: request.url,
            body: yield* bodyOf(request),
            time: request.headers[RequestSignature.signatureHeaders.time],
            nonce: request.headers[RequestSignature.signatureHeaders.nonce],
            signature: request.headers[RequestSignature.signatureHeaders.signature]
          },
          yield* Clock.currentTimeMillis,
          nonces
        )
        if (problem !== undefined) {
          return yield* Effect.fail(new InvalidSignature({ message: problemMessages[problem] }))
        }
      })
    return {
      bearer: (httpEffect, { credential }) =>
        Effect.gen(function*() {
          const device = yield* devices.authenticate(Redacted.value(credential))
          if (Option.isNone(device)) return yield* Effect.fail(new HttpApiError.Unauthorized())
          if (device.value.deviceKey !== null) yield* signed(device.value.deviceKey)
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentDevice, { id: device.value.id, name: device.value.name }),
            // A screen may show what was read within the minute; what acts reads again.
            Effect.provideService(AnswersKeptFor, request.method === "GET" ? screenAnswerKeptMs : answerKeptMs)
          )
        })
    }
  })
)
