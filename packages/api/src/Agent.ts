import { Schema } from "effect"

/**
 * The agent ↔ cloud protocol (docs/spec-v2-hosted.md). The agent runs at home, next to the
 * services; it opens one WebSocket to the cloud, forwards webhooks, and runs the HTTP calls the
 * cloud asks for when the allowlist below lets them through. Bump `protocolVersion` on any change
 * an older agent couldn't follow.
 */
export const protocolVersion = 1

/** The services an agent can reach. */
export const AgentService = Schema.Literals(["radarr", "sonarr", "qbittorrent", "jellyfin"])
export type AgentService = typeof AgentService.Type

// Agent → cloud

export const Hello = Schema.TaggedStruct("Hello", {
  protocol: Schema.Number,
  agentVersion: Schema.String,
  token: Schema.String,
  /** The services this agent has a URL (and key) for. */
  services: Schema.Array(AgentService)
})

export const WebhookReceived = Schema.TaggedStruct("WebhookReceived", {
  service: AgentService,
  body: Schema.Unknown
})

export const ProxyResponse = Schema.TaggedStruct("ProxyResponse", {
  id: Schema.String,
  status: Schema.Number,
  body: Schema.String
})

/** The call didn't reach the service, or the allowlist refused it. */
export const ProxyFailure = Schema.TaggedStruct("ProxyFailure", {
  id: Schema.String,
  reason: Schema.String
})

export const AgentMessage = Schema.Union([Hello, WebhookReceived, ProxyResponse, ProxyFailure])
export type AgentMessage = typeof AgentMessage.Type

// Cloud → agent

/** The cloud accepted the agent's Hello. */
export const Welcome = Schema.TaggedStruct("Welcome", {
  homeName: Schema.String
})

export const ProxyRequest = Schema.TaggedStruct("ProxyRequest", {
  id: Schema.String,
  service: AgentService,
  method: Schema.Literals(["GET", "POST"]),
  /** Path and query, as the service expects them: `/api/v2/torrents/info?hashes=a|b`. */
  path: Schema.String,
  /** JSON body, for POST. */
  body: Schema.optionalKey(Schema.Unknown)
})
export type ProxyRequest = typeof ProxyRequest.Type

/** The cloud refuses the agent (bad token, protocol too old): the agent stops retrying for a while. */
export const Refused = Schema.TaggedStruct("Refused", {
  reason: Schema.String
})

export const CloudMessage = Schema.Union([Welcome, ProxyRequest, Refused])
export type CloudMessage = typeof CloudMessage.Type

/**
 * What the cloud may ask an agent to call, per service: method and path pattern (the query is
 * not checked). Reads Quai needs, and the writes the action catalog offers. The agent enforces
 * it: a compromised cloud can't delete a library or read the services' settings.
 */
export const agentAllowlist: Record<AgentService, ReadonlyArray<{ readonly method: "GET" | "POST"; readonly path: RegExp }>> = {
  radarr: [{ method: "GET", path: /^\/api\/v3\/system\/status$/ }],
  sonarr: [{ method: "GET", path: /^\/api\/v3\/system\/status$/ }],
  qbittorrent: [
    { method: "GET", path: /^\/api\/v2\/app\/version$/ },
    { method: "GET", path: /^\/api\/v2\/torrents\/info$/ }
  ],
  jellyfin: [
    { method: "GET", path: /^\/System\/Info\/Public$/ },
    { method: "GET", path: /^\/Items$/ },
    { method: "GET", path: /^\/Sessions$/ },
    { method: "POST", path: /^\/Sessions\/[\w-]+\/Playing\/(PlayPause|Stop)$/ }
  ]
}

/** Whether the allowlist lets this call through. */
export const allowed = (request: Pick<ProxyRequest, "service" | "method" | "path">): boolean => {
  const path = request.path.split("?")[0]!
  return !path.includes("..") && agentAllowlist[request.service].some((rule) => rule.method === request.method && rule.path.test(path))
}
