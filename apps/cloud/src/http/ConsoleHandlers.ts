import { QuaiApi } from "@quai/api"
import { DateTime, Effect, Option, Redacted } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { Devices } from "../home/Devices.ts"
import { type AccessHeader, PublicAccess } from "../PublicAccess.ts"

/**
 * The QR code's content: the code, every address the app may reach the server at, and the access
 * headers the proxy in front of it requires. Percent-encoded (`%20`, never `+`) so the app's
 * `URLComponents` reads back exactly what was written.
 */
export const pairingLink = (code: string, serverUrls: ReadonlyArray<string>, headers: ReadonlyArray<AccessHeader> = []) => {
  const params = [
    ["code", code],
    ...serverUrls.map((url) => ["url", url]),
    ...headers.map((header) => ["header", `${header.name}: ${Redacted.value(header.value)}`])
  ]
  return `quai://pair?${params.map(([name, value]) => `${name}=${encodeURIComponent(value!)}`).join("&")}`
}

export const ConsoleHandlers = HttpApiBuilder.group(QuaiApi, "console", (handlers) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    // The address from outside (behind a reverse proxy, say), on top of the one the console uses.
    const publicAccess = yield* PublicAccess
    return handlers
      .handle("createPairingCode", ({ payload }) =>
        Effect.map(devices.createPairingCode, ({ code, expiresAt }) => {
          const urls = [...new Set([...payload.serverUrls, ...Option.toArray(publicAccess.url)])]
          return {
            code,
            expiresAt: DateTime.makeUnsafe(expiresAt),
            link: pairingLink(code, urls, publicAccess.headers),
            accessHeaderNames: publicAccess.settings.accessHeaderNames
          }
        }))
      .handle("devices", () =>
        Effect.map(devices.list, (list) =>
          list.map((device) => ({
            id: device.id,
            name: device.name,
            apnsEnvironment: device.apnsEnvironment,
            canStartActivities: device.pushToStartToken !== null,
            pairedAt: DateTime.makeUnsafe(device.pairedAt),
            ...(device.lastSeenAt === null ? {} : { lastSeenAt: DateTime.makeUnsafe(device.lastSeenAt) })
          }))))
      .handle("removeDevice", ({ params }) =>
        Effect.flatMap(devices.remove(params.id), (removed) =>
          removed ? Effect.void : Effect.fail(new HttpApiError.NotFound())))
  }))
