import { QuaiApi } from "@quai/api"
import { Config, DateTime, Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { Devices } from "../store/Devices.ts"

/** The QR code's content: the app reads the code and every address it may reach the server at. */
export const pairingLink = (code: string, serverUrls: ReadonlyArray<string>) => {
  const params = new URLSearchParams({ code })
  for (const url of serverUrls) params.append("url", url)
  return `quai://pair?${params.toString()}`
}

export const ConsoleHandlers = HttpApiBuilder.group(QuaiApi, "console", (handlers) =>
  Effect.gen(function*() {
    const devices = yield* Devices
    // The address from outside (behind Cloudflare Access, say), on top of the one the console uses.
    const publicUrl = yield* Config.option(Config.String("QUAI_PUBLIC_URL"))
    return handlers
      .handle("createPairingCode", ({ payload }) =>
        Effect.map(devices.createPairingCode, ({ code, expiresAt }) => {
          const urls = [...new Set([...payload.serverUrls, ...Option.toArray(publicUrl)])]
          return { code, expiresAt: DateTime.makeUnsafe(expiresAt), link: pairingLink(code, urls) }
        }))
      .handle("devices", () =>
        Effect.map(devices.list, (list) =>
          list.map((d) => ({
            id: d.id,
            name: d.name,
            apnsEnvironment: d.apnsEnvironment,
            canStartActivities: d.pushToStartToken !== null,
            pairedAt: DateTime.makeUnsafe(d.pairedAt),
            lastSeenAt: d.lastSeenAt === null ? null : DateTime.makeUnsafe(d.lastSeenAt)
          }))))
      .handle("removeDevice", ({ params }) =>
        Effect.flatMap(devices.remove(params.id), (removed) =>
          removed ? Effect.void : Effect.fail(new HttpApiError.NotFound())))
  }))
