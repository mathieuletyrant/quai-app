import { HomeProtocol } from "@quai/api"
import * as HomeId from "@quai/api/HomeId"
import { Effect, Option, Queue, type Scope } from "effect"
import { Socket } from "effect/socket"
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { HomeLinks } from "../../src/home/HomeLinks.ts"
import { settle } from "../fakeHome.ts"

type CloudMessageOf<Tag extends HomeProtocol.CloudMessage["_tag"]> = Extract<
  HomeProtocol.CloudMessage,
  { readonly _tag: Tag }
>
/** An answer for each message the Cloud sends, by its `_tag`. */
type Responders = {
  readonly [Tag in HomeProtocol.CloudMessage["_tag"]]: (message: CloudMessageOf<Tag>) => HomeProtocol.HomeMessage | null
}

/** What the fake Quai Home's routes answer one of the app's requests. */
export interface AppAnswer {
  readonly status: number
  readonly body?: string
  readonly contentType?: string
}

export interface LinkedHomeOptions {
  /** What its own routes answer the app's requests the Cloud relays. Default: 404. "silent": no answer. */
  readonly answerApp?: (request: HomeProtocol.AppRequest) => AppAnswer | "silent"
  /** Default: the current protocol. */
  readonly protocol?: number
  /** Signs with another key than the one in Hello. */
  readonly badProof?: boolean
  /** Another home: its own key. Default: `linkedHomeKey`. */
  readonly privateKey?: KeyObject
  /** Doesn't answer Pings. */
  readonly deaf?: boolean
}

const close = Symbol("close")

/** The fake home's key unless a test gives another: the same home in every test. */
export const linkedHomeKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)]),
  format: "der",
  type: "pkcs8"
})

const publicKeyOf = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64")

/** A key of another home. */
export const otherHomeKey = () => generateKeyPairSync("ed25519").privateKey

/**
 * Quai Home on its WebSocket to the Cloud, in memory: it says Hello with a real Ed25519 key and
 * proves it, answers the app's requests the Cloud relays (`answerApp`), asks for pushes and says
 * its open pairing codes. Talks to the real `HomeLinks` through an in-memory socket.
 */
export const makeLinkedHome = (options: LinkedHomeOptions = {}) =>
  Effect.sync(() => {
    const privateKey = options.privateKey ?? linkedHomeKey
    const otherKey = otherHomeKey()
    const publicKey = publicKeyOf(privateKey)
    const homeId = HomeId.homeId(publicKey)
    const appRequests: Array<HomeProtocol.AppRequest> = []
    const pushAnswers = new Map<string, HomeProtocol.PushResponse>()
    const received: Array<HomeProtocol.CloudMessage> = []
    const state = {
      refused: null as { readonly reason: string; readonly retryAfterSeconds: number } | null,
      welcomed: null as string | null,
      closed: false,
      toCloud: null as Queue.Queue<string | typeof close> | null
    }

    const responders: Responders = {
      Challenge: (message) =>
        HomeProtocol.Proof.make({
          signature: sign(
            null,
            Buffer.from(HomeProtocol.challengePayload(message.nonce)),
            options.badProof === true ? otherKey : privateKey
          ).toString("base64")
        }),
      Welcome: (message) => {
        state.welcomed = message.homeId
        return null
      },
      Refused: (message) => {
        state.refused = { reason: message.reason, retryAfterSeconds: message.retryAfterSeconds }
        return null
      },
      Ping: (message) => options.deaf === true ? null : HomeProtocol.Pong.make({ at: message.at }),
      AppRequest: (message) => {
        appRequests.push(message)
        const answer = options.answerApp?.(message) ?? { status: 404 }
        return answer === "silent" ? null : HomeProtocol.AppResponse.make({
          id: message.id,
          status: answer.status,
          body: answer.body ?? "",
          ...(answer.contentType === undefined ? {} : { contentType: answer.contentType })
        })
      },
      PushResponse: (message) => {
        pushAnswers.set(message.id, message)
        return null
      }
    }

    const respond = (message: HomeProtocol.CloudMessage): HomeProtocol.HomeMessage | null => {
      received.push(message)
      // The table gives each tag its own message; TypeScript can't follow the tag from the union.
      const responder = responders[message._tag] as (
        message: HomeProtocol.CloudMessage
      ) => HomeProtocol.HomeMessage | null
      return responder(message)
    }

    /** Sends a frame as it is: a message of the protocol, or anything else. */
    const sendRaw = (frame: object | string) =>
      Effect.andThen(
        Effect.suspend(() =>
          state.toCloud === null
            ? Effect.void
            : Effect.asVoid(Queue.offer(state.toCloud, typeof frame === "string" ? frame : JSON.stringify(frame)))
        ),
        settle
      )

    /** Opens a connection: the links serve it in the background. Settles before returning. */
    const open: Effect.Effect<void, never, HomeLinks | Scope.Scope> = Effect.gen(function*() {
      const links = yield* HomeLinks
      const toCloud = yield* Queue.unbounded<string | typeof close>()
      state.toCloud = toCloud
      state.closed = false
      const socket = Socket.make({
        reader: Effect.succeed({
          pull: Effect.flatMap(Queue.take(toCloud), (frame) =>
            frame === close
              ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))
              : Effect.succeed([frame] as const)),
          upgrade: Socket.SocketUpgradeError.unsupported
        }),
        writer: Effect.succeed({
          write: (chunk) =>
            Effect.suspend(() => {
              if (Socket.isCloseEvent(chunk)) {
                state.closed = true
                return Effect.void
              }
              const reply = respond(JSON.parse(String(chunk)))
              return reply === null ? Effect.void : Effect.asVoid(Queue.offer(toCloud, JSON.stringify(reply)))
            }),
          writeAll: () => Effect.void
        })
      })
      yield* Effect.forkScoped(links.serve(socket))
      yield* Queue.offer(
        toCloud,
        JSON.stringify(
          HomeProtocol.Hello.make({
            protocol: options.protocol ?? HomeProtocol.protocolVersion,
            homeVersion: "test",
            publicKey
          })
        )
      )
      yield* settle
    })

    return {
      homeId,
      privateKey,
      received,
      state,
      /** The app's requests the Cloud relayed. */
      appRequests,
      /** Connects and stops there, whatever the Cloud says. */
      open,
      /** Connects and waits until the Cloud linked it. */
      connect: Effect.gen(function*() {
        yield* open
        const links = yield* HomeLinks
        for (let attempt = 0; attempt < 20 && !(yield* links.homeIds).includes(homeId); attempt++) yield* settle
        if (!(yield* links.homeIds).includes(homeId)) {
          return yield* Effect.die(`the fake home didn't link: ${JSON.stringify(state.refused)}`)
        }
      }),
      /** Drops the connection, as a network cut. */
      disconnect: Effect.gen(function*() {
        if (state.toCloud !== null) yield* Queue.offer(state.toCloud, close)
        state.toCloud = null
        yield* settle
      }),
      sendRaw,
      /** Asks the Cloud for a push: what it answered, once it did. */
      push: (request: Omit<HomeProtocol.PushRequest, "_tag">) =>
        Effect.gen(function*() {
          yield* sendRaw(HomeProtocol.PushRequest.make(request))
          for (let attempt = 0; attempt < 20 && !pushAnswers.has(request.id); attempt++) yield* settle
          return Option.fromNullishOr(pushAnswers.get(request.id))
        }),
      /** Tells the Cloud this home's open pairing codes, by their hashes. */
      pairingCodes: (hashes: ReadonlyArray<string>) => sendRaw(HomeProtocol.PairingCodes.make({ hashes }))
    }
  })

export type LinkedHome = Effect.Success<ReturnType<typeof makeLinkedHome>>
