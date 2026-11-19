# Quai — spec v2: Quai Relay at home, Quai Core hosted

Nov 19, 2026 · Mathieu Le Tyrant

## Why

v1 runs everything on the user's server: integrations, flow engine, APNs, console. That works for
one household, but not to ship Quai to other people:

- **Every change is an update on every server.** A new flow, a fix in the engine or the console
  waits for each user to update their app on Umbrel, Unraid or Docker. Bugs stay in the field.
- **Every user needs an Apple Developer account.** Pushing to the Quai app needs Quai's APNs key;
  a user's own key only works with their own build of the app.
- **The iPhone must reach the home server.** On the LAN that's fine; away from home it needs a
  tunnel, a public URL or a VPN that most people don't have.
- **Two moving versions.** The iOS app and each server must agree on the contract, at every
  version of each.

## The idea

Split Quai in two:

```
 home (open source, rarely updated)          Quai cloud (open source, hosted by us)        iPhone
┌──────────────────────────────┐   outbound   ┌────────────────────────────────────┐
│ Agent                        │  WebSocket   │ integrations: what an event means  │  HTTPS  ┌──────────┐
│ - holds the *arr keys        │ ───────────▶ │ flow engine, flows, preferences    │ ◀─────▶ │ Quai app │
│ - forwards webhooks          │              │ console (web)                      │         └──────────┘
│ - runs allowlisted calls     │ ◀─────────── │ APNs (Quai's key)                  │ ──push──▶
│   to Radarr, Sonarr, …       │   requests   │ accounts, homes                    │
└──────────────────────────────┘              └────────────────────────────────────┘
```

**The agent is dumb on purpose.** It knows how to reach the services on the LAN with their keys,
and nothing about Live Activities. It:

1. opens one outbound WebSocket to the cloud: no port to open, no tunnel, no public URL;
2. forwards webhook payloads (Radarr, Sonarr, Jellyfin) as they come;
3. runs the HTTP calls the cloud asks for, within an allowlist of endpoints per service
   (`GET /api/v2/torrents/info`, `POST /Sessions/{id}/Playing/PlayPause`, …), and returns the response.

Everything that can change often (reading a payload, polling, flows, the engine, pushes, the
console) lives in the cloud. The agent changes only when a new service, or a new allowlisted
endpoint, comes in. The protocol is versioned, and the cloud adapts to the agent's version.

**The cloud** is today's server, made multi-home: integrations, engine, flows, targeting, APNs with
Quai's own key, the console, and the API the app uses. Each home is a tenant.

**The app** talks only to the cloud: one fixed URL, signed in, reachable everywhere. Pairing
becomes linking a home to an account.

## Names and roles

- **Quai Relay** runs at home, next to the services. It holds their keys, sets up their webhooks,
  polls what the Core asks it to watch, and forwards what comes in. It knows nothing about Live
  Activities.
- **Quai Core** is the brain: integrations (what an event means), flows, the engine, the console,
  pushes, accounts and the app's API. We host it; it's open source like the Relay.

### Polling at home, meaning in the Core

The Core sends the Relay **watches**: a service, an allowlisted path and a period ("qBittorrent
`/api/v2/torrents/info?hashes=…` every 15 s", "Jellyfin `/Sessions` every 15 s while a playback
flow is on"). The Relay polls on the LAN and forwards a snapshot only when it changed. The Core
replaces the watch list whenever what its flows need changes. One-off calls (a Play/Pause button)
stay request/response.

So a new flow or a fix in how an event is read ships from the Core alone; the Relay changes only
for a new service or a new allowlisted endpoint.

### Self-hosting

The Relay and the Core are two images; a compose file runs both on one machine for those who
want everything at home. It's the same code, not a second mode. Apple only accepts pushes to the
App Store app signed with Quai's key, so a self-hosted Core sends its pushes through a small push
gateway we host, which sees only the notification itself; or it brings its own APNs key and its
own build of the app.

## Open source

Everything stays Apache-2.0, agent and cloud, in this monorepo. What we sell, or offer, is the
hosted cloud: its uptime, its APNs key and the App Store app tied to it. That's the Bitwarden or
Home Assistant Cloud model.

Self-hosting the cloud stays possible but costs what v1 costs: your own APNs key and your own build
of the app (Apple ties pushes to the app's key). It's documented, not the default.

The trademark policy (TRADEMARKS.md) keeps the Quai name and logo for the hosted service.

## Nothing stored in the Core

The hosted Core keeps nothing: no database, nothing on disk, no account. Everything that lasts
lives at home, in the Relay's `/data`:

- flows and their settings;
- paired iPhones, their push tokens and preferences;
- the state of running activities, written back as it changes.

The Relay stores and returns these documents without reading them, so it stays dumb. The Core
works in memory: when a Relay connects, the Core loads its home from it; every change is written
back to the Relay before it's acknowledged. A restarted Core loses nothing, it reloads as Relays
reconnect.

**No accounts.** An iPhone pairs with the Relay, as in v1 (QR code from the console). The app then
talks to the Core with its home id and device token, and the Core checks the token against the
Relay. Sign in with Apple and an accounts table aren't needed.

**What we can promise:** nothing about a home is kept by the Core; logs carry no titles, names or
tokens. What we can't: the Core sees titles and progress while it computes and pushes them. A
public privacy page says exactly that, and the code is open to check it. Who doesn't want even
that self-hosts the Core.

## Security and privacy

- **The *arr keys never leave home.** The agent holds them; the cloud only asks for calls.
- **The allowlist is in the agent.** A compromised cloud can't delete a library or read config
  endpoints: the agent refuses anything outside it. Writes are limited to the actions the catalog
  offers (Jellyfin play/pause/stop, later search or retry).
- **What leaves home:** titles, progress, playback sessions and service health — what a Live
  Activity shows — in transit only (see above).
- **Agent ↔ cloud:** TLS, one token per agent, issued at linking, revocable from the console.
- **App ↔ Core:** the device token the Relay issued at pairing, checked against the Relay.

## Linking a home

1. The user installs the Relay (Umbrel, Docker) with the service keys, as today.
2. On first start the Relay creates its home key pair in `/data`. Its home id is the public key's
   fingerprint: the Core recognizes a home by proof of the private key (a signed challenge), so it
   needs nothing stored to tell homes apart or to stop one impersonating another.
3. The Relay's tile opens the console on the Core with a short-lived link the Relay signs.
4. In the console, "Pair an iPhone" shows a QR code as in v1; the app scans it, gets its device
   token from the Relay and talks to the Core from then on, from anywhere.

Several iPhones (Julie's) pair the same way, each with its own preferences.

## What it changes in this repo

| Today | v2 |
| --- | --- |
| `apps/server` | splits into `apps/agent` (small: WebSocket, webhook forwarding, allowlisted proxy) and `apps/cloud` (the rest, multi-home) |
| `packages/api` | adds the agent ↔ cloud protocol (Effect `Schema` messages) next to the HTTP contract |
| `src/integrations/*` | move to the cloud; their HTTP calls go through the agent instead of `fetch` |
| SQLite on `/data` | cloud database (Postgres, or SQLite per home); the agent keeps only its token |
| console served by the server | served by the cloud, signed in |
| iOS: pairing by QR + LAN URL | sign in, cloud URL; the rest of the app unchanged |
| Umbrel app `mathieu-quai` | becomes the agent: smaller image, same settings, plus the link code |

What carries over unchanged: the catalog, flows, engine, targeting, Live Activity payloads, the
iOS widget, the console UI, and the tests around them.

## Plan

1. **Protocol and agent.** Message schemas; the agent with webhook forwarding and the allowlisted
   proxy; tests with recorded responses.
2. **Cloud, single home first.** Today's server on the protocol: integrations call through the
   agent. Runs against my home to validate.
3. **Multi-home and accounts.** Homes, accounts, linking, per-home data; console signed in.
4. **iOS.** Sign in, cloud URL, invitation of a second iPhone.
5. **Hosting.** Domain, deploy, backups, monitoring; then TestFlight for a few outside testers.

v1 keeps working for me until step 4 ships; then the Umbrel app switches to the agent.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Hosting of the cloud | A small Node server (VPS or Fly.io) | Runs today's Effect code almost as is; cheap; Cloudflare would mean rewriting for its runtime |
| Accounts | None: iPhones pair with the Relay; the Core checks tokens against it | The Core stores nothing about anyone |
| Storage | All state in the Relay's `/data`; the Core is memory-only | "We keep nothing" must be true, and checkable in the code |
| How dumb the agent is | Allowlisted proxy | The agent almost never changes; every fix and flow ships from the cloud |
| Self-hosted all-in-one | Relay + Core in one compose, pushes through our gateway | Same code as hosted, no second mode to maintain |
| Polling | In the Relay, driven by the Core's watches | Polling stays on the LAN; what it means stays in the Core |
