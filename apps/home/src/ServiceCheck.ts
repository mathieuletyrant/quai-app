import { type HomeProtocol, journalSourceNames, type ServiceCheck } from "@quai/api"
import { Effect, Option, Schema } from "effect"
import { HttpClientRequest } from "effect/http"
import { ServiceAuth } from "./ServiceAuth.ts"

/**
 * What the Services page reads to check a service: a route that needs the key (a public one would
 * answer even with a wrong key), and that says nothing secret.
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
  if (status === 401 || status === 403) {
    return { outcome: "refused", message: `${name} refused the key (HTTP ${status})` }
  }
  if (status < 200 || status >= 300) return { outcome: "failed", message: `${name} answered HTTP ${status}` }
  // qBittorrent answers its version as plain text: "v5.1.2".
  const version = service === "qbittorrent"
    ? Option.some(body.trim()).pipe(Option.filter((text) => /^v?\d[\w.-]*$/.test(text)))
    : Option.map(decodeVersion(body), (decoded) => decoded.version)
  return Option.match(Option.map(version, (raw) => raw.replace(/^v/, "")), {
    onNone: () => ({ outcome: "ok", message: `${name} reached` }),
    onSome: (versionNumber) => ({ outcome: "ok", message: `${name} ${versionNumber}`, version: versionNumber })
  })
}

/** A scope a key may lack, the call that needs it, and what Quai can't do without it. */
export interface ScopeCheck {
  readonly path: string
  readonly scope: string
  readonly without: string
}

/**
 * Reclaimerr's key may lack a scope Quai reads with: its event feed (`events:read`), which tells what
 * it deleted, and its deletion task (`tasks:read`), which tells when. The other reads work without
 * them, so the check says it rather than fails.
 */
export const scopePaths: Partial<Record<HomeProtocol.HomeService, ReadonlyArray<ScopeCheck>>> = {
  reclaimerr: [
    { path: "/api/v1/events?limit=1", scope: "events:read", without: "nothing it deletes is said to be gone" },
    {
      path: "/api/v1/tasks/delete_cleanup_candidates",
      scope: "tasks:read",
      without: "when it deletes is only the earliest"
    }
  ]
}

/** A check that passed, with what a scope Reclaimerr refused (HTTP 401 or 403) leaves out. */
export const withScope = (check: ServiceCheck, scope: ScopeCheck, status: number): ServiceCheck =>
  check.outcome === "ok" && (status === 401 || status === 403)
    ? { ...check, message: `${check.message} · the key lacks ${scope.scope}: ${scope.without}` }
    : check

/** Reaches the service with its address and key as they are now. Never fails: what went wrong is the check's outcome. */
export const checkService = (service: HomeProtocol.HomeService) =>
  Effect.flatMap(reachService(service), (check) => {
    const scopes = scopePaths[service] ?? []
    if (scopes.length === 0 || check.outcome !== "ok") return Effect.succeed(check)
    return Effect.reduce(scopes, () => check, (checked: ServiceCheck, scope) =>
      Effect.gen(function*() {
        const auth = yield* ServiceAuth
        const response = yield* auth.execute(service, HttpClientRequest.get(scope.path))
        return withScope(checked, scope, response.status)
      }).pipe(Effect.timeout("10 seconds"), Effect.orElseSucceed(() => checked)))
  })

const reachService = (service: HomeProtocol.HomeService) =>
  Effect.gen(function*() {
    const auth = yield* ServiceAuth
    return yield* auth.execute(service, HttpClientRequest.get(checkPaths[service])).pipe(
      Effect.flatMap((response) => Effect.map(response.text, (body) => verdict(service, response.status, body))),
      Effect.timeout("10 seconds"),
      Effect.catch((error): Effect.Effect<ServiceCheck> =>
        Effect.succeed(
          error._tag === "ServiceError" && error.message !== "unreachable"
            ? {
              outcome: error.message === "not configured" ? "failed" : "refused",
              message: `${journalSourceNames[service]}: ${error.message}`
            }
            : { outcome: "unreachable", message: `${journalSourceNames[service]} doesn't answer at this address` }
        )
      )
    )
  })
