import { type HomeProtocol, journalSourceNames, type ServiceCheck } from "@quai/api"
import { Effect, Option, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceAuth } from "./ServiceAuth.ts"

/**
 * What the Services page reads to check a service: a route that needs the key (a public one would
 * answer even with a wrong key), and that says nothing secret. Quai Home's own call, outside the
 * Cloud's allowlist.
 */
export const checkPaths: Record<HomeProtocol.HomeService, string> = {
  radarr: "/api/v3/system/status",
  sonarr: "/api/v3/system/status",
  prowlarr: "/api/v1/system/status",
  qbittorrent: "/api/v2/app/version",
  jellyfin: "/System/Info",
  reclaimerr: "/api/v1/system",
  seerr: "/api/v1/auth/me",
  cleanuparr: "/api/jobs/QueueCleaner"
}

const decodeVersion = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))

/** What an answer means: reached (with its version when it says one), the key refused, or another failure. */
export const verdict = (service: HomeProtocol.HomeService, status: number, body: string): ServiceCheck => {
  const name = journalSourceNames[service]
  if (status === 401 || status === 403) return { outcome: "refused", message: `${name} refused the key (HTTP ${status})` }
  if (status < 200 || status >= 300) return { outcome: "failed", message: `${name} answered HTTP ${status}` }
  // qBittorrent answers its version as plain text: "v5.1.2".
  const version = service === "qbittorrent"
    ? Option.some(body.trim()).pipe(Option.filter((v) => /^v?\d[\w.-]*$/.test(v)))
    : Option.map(decodeVersion(body), (b) => b.version)
  return Option.match(Option.map(version, (v) => v.replace(/^v/, "")), {
    onNone: () => ({ outcome: "ok", message: `${name} reached` }),
    onSome: (v) => ({ outcome: "ok", message: `${name} ${v}`, version: v })
  })
}

/** Reaches the service with its address and key as they are now. Never fails: what went wrong is the check's outcome. */
export const checkService = (service: HomeProtocol.HomeService) =>
  Effect.gen(function*() {
    const auth = yield* ServiceAuth
    return yield* auth.execute(service, HttpClientRequest.get(checkPaths[service])).pipe(
      Effect.flatMap((response) => Effect.map(response.text, (body) => verdict(service, response.status, body))),
      Effect.timeout("10 seconds"),
      Effect.catch((error): Effect.Effect<ServiceCheck> =>
        Effect.succeed(
          error._tag === "ServiceError" && error.message !== "unreachable"
            ? { outcome: error.message === "not configured" ? "failed" : "refused", message: `${journalSourceNames[service]}: ${error.message}` }
            : { outcome: "unreachable", message: `${journalSourceNames[service]} doesn't answer at this address` }
        ))
    )
  })
