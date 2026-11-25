import { type ConsoleAccess, WrongPassword } from "@quai/api"
import { Clock, Context, Effect, Layer, Redacted } from "effect"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { HomeConfig } from "./Config.ts"
import { HomeKey } from "./HomeKey.ts"

/** A session lasts this long in the browser that signed in. */
export const sessionDays = 30
export const sessionMs = sessionDays * 24 * 60 * 60 * 1000

const digest = (text: string) => createHash("sha256").update(text).digest()

/**
 * A session token: its expiry, and a MAC of it and of the password, keyed by the home key. Nothing
 * is kept: changing `QUAI_HOME_PASSWORD` makes every token wrong, which signs every browser out.
 */
export const sessionToken = (secret: Buffer, password: string, expiresAt: number) =>
  `${expiresAt}.${createHmac("sha256", secret).update(`${expiresAt}:`).update(digest(password)).digest("base64url")}`

/** Whether `token` is one `sessionToken` made with this password, and not expired at `now`. */
export const validToken = (secret: Buffer, password: string, token: string, now: number) => {
  const [expires, mac] = token.split(".")
  const expiresAt = Number(expires)
  if (mac === undefined || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false
  const expected = Buffer.from(sessionToken(secret, password, expiresAt))
  const given = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The console's password (`QUAI_HOME_PASSWORD`) and its sessions. */
export class ConsoleAuth extends Context.Service<ConsoleAuth, {
  /** Where a browser with this cookie (if any) stands. */
  readonly access: (token: string | undefined) => Effect.Effect<ConsoleAccess["state"]>
  /** A new session token, for the right password. */
  readonly signIn: (
    password: string
  ) => Effect.Effect<{ readonly token: string; readonly expiresAt: number }, WrongPassword>
}>()("quai-home/ConsoleAuth") {
  static readonly layer = Layer.effect(
    ConsoleAuth,
    Effect.gen(function*() {
      const config = yield* HomeConfig
      const { consoleSecret } = yield* HomeKey
      const password = config.password === null ? null : Redacted.value(config.password)
      return {
        access: (token) =>
          Effect.map(Clock.currentTimeMillis, (now) =>
            password === null
              ? "locked"
              : token !== undefined && validToken(consoleSecret, password, token, now)
              ? "signedIn"
              : "signedOut"),
        signIn: (given) =>
          Effect.gen(function*() {
            if (password === null) {
              return yield* Effect.fail(new WrongPassword({ message: "Set QUAI_HOME_PASSWORD on Quai Home first" }))
            }
            if (!timingSafeEqual(digest(given), digest(password))) {
              return yield* Effect.fail(new WrongPassword({ message: "Wrong password" }))
            }
            const expiresAt = (yield* Clock.currentTimeMillis) + sessionMs
            return { token: sessionToken(consoleSecret, password, expiresAt), expiresAt }
          })
      }
    })
  )
}
