import { Effect, Option, Queue } from "effect"
import { Socket } from "effect/socket"

/** Closes the connection, as a network cut: offered to a connection's `incoming`. */
export const close = Symbol("close")

/** One connection the home opened: what the cloud sends it, and what it wrote. */
export interface Connection {
  readonly incoming: Queue.Queue<string | typeof close>
  readonly sent: Queue.Queue<any>
}

/** A Socket whose every reader acquisition is a new connection, handed to the test. */
export const fakeSocket = Effect.gen(function*() {
  const connections = yield* Queue.unbounded<Connection>()
  let latest: Connection | null = null
  const socket = Socket.make({
    reader: Effect.gen(function*() {
      const connection: Connection = {
        incoming: yield* Queue.unbounded<string | typeof close>(),
        sent: yield* Queue.unbounded<any>()
      }
      latest = connection
      yield* Queue.offer(connections, connection)
      return {
        pull: Effect.flatMap(Queue.take(connection.incoming), (frame) =>
          frame === close
            ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))
            : Effect.succeed([frame] as const)),
        upgrade: Socket.SocketUpgradeError.unsupported
      }
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        Queue.offer(latest!.sent, typeof chunk === "string" ? JSON.parse(chunk) : chunk).pipe(Effect.asVoid),
      writeAll: () => Effect.void
    })
  })
  return { socket, connections }
})

/** The Cloud sends a message (or a raw frame) on a connection. */
export const cloud = (connection: Connection, message: object | string) =>
  Queue.offer(connection.incoming, typeof message === "string" ? message : JSON.stringify(message))

/** The Cloud's Welcome to this home: no APNs key, no public address, unless `said` says otherwise. */
export const welcomeOf = (homeId: string, said: object = {}) => ({
  _tag: "Welcome",
  homeId,
  version: "test",
  push: { configured: false, topic: "com.mathieuletyrant.quai" },
  publicAccess: { headers: [] },
  ...said
})

/** Lets forked fibers run up to their next wait. */
export const settle = Effect.repeat(Effect.yieldNow, { times: 20 })

export const nothingSent = (connection: Connection) =>
  Effect.map(Effect.andThen(settle, Queue.size(connection.sent)), (size) => size === 0)
export const noConnection = (connections: Queue.Queue<Connection>) =>
  Effect.map(Effect.andThen(settle, Queue.poll(connections)), Option.isNone)
