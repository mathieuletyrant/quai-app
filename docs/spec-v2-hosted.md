# Quai — spec v2: Quai Home at home, Quai Cloud hosted

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
│ Home                        │  WebSocket   │ integrations: what an event means  │  HTTPS  ┌──────────┐
│ - holds the *arr keys        │ ───────────▶ │ flow engine, flows, preferences    │ ◀─────▶ │ Quai app │
│ - forwards webhooks          │              │ console (web)                      │         └──────────┘
│ - runs allowlisted calls     │ ◀─────────── │ APNs (Quai's key)                  │ ──push──▶
│   to Radarr, Sonarr, …       │   requests   │ accounts, homes                    │
└──────────────────────────────┘              └────────────────────────────────────┘
```

**The Home is dumb on purpose.** It knows how to reach the services on the LAN with their keys,
and nothing about Live Activities. It:

1. opens one outbound WebSocket to the Cloud: no port to open, no tunnel, no public URL;
2. forwards webhook payloads (Radarr, Sonarr, Seerr) as they come;
3. runs the HTTP calls the Cloud asks for, within an allowlist of endpoints per service
   (`GET /api/v2/torrents/info`, `POST /Sessions/{id}/Playing/PlayPause`, …), and returns the response.

Everything that can change often (reading a payload, polling, flows, the engine, pushes, the
console) lives in the Cloud. The Home changes only when a new service, or a new allowlisted
endpoint, comes in. The protocol is versioned, and the Cloud adapts to the Home's version.

**The Cloud** is today's server, made multi-home: integrations, engine, flows, targeting, APNs with
Quai's own key, the console, and the API the app uses. Each home is a tenant.

**The app** talks only to the Cloud: one fixed URL, signed in, reachable everywhere. Pairing
becomes linking a home to an account.

## Names and roles

- **Quai Home** runs at home, next to the services. It holds their keys, sets up their webhooks,
  polls what the Cloud asks it to watch, and forwards what comes in. It knows nothing about Live
  Activities.
- **Quai Cloud** is the brain: integrations (what an event means), flows, the engine, the console,
  pushes, accounts and the app's API. We host it; it's open source like the Home.

### Polling at home, meaning in the Cloud

The Cloud sends the Home **watches**: a service, an allowlisted path and a period ("qBittorrent
`/api/v2/torrents/info?hashes=…` every 5 s", "Jellyfin `/Sessions` every 15 s while a playback
flow is on"). The Home polls on the LAN and forwards a snapshot only when it changed. The Cloud
replaces the watch list whenever what its flows need changes. One-off calls (a Play/Pause button)
stay request/response.

So a new flow or a fix in how an event is read ships from the Cloud alone; the Home changes only
for a new service or a new allowlisted endpoint.

### Self-hosting

The Home and the Cloud are two images; a compose file runs both on one machine for those who
want everything at home. It's the same code, not a second mode. Apple only accepts pushes to the
App Store app signed with Quai's key, so a self-hosted Cloud sends its pushes through a small push
gateway we host, which sees only the notification itself; or it brings its own APNs key and its
own build of the app.

## Open source

Everything stays Apache-2.0, Home and cloud, in this monorepo. What we sell, or offer, is the
hosted cloud: its uptime, its APNs key and the App Store app tied to it. That's the Bitwarden or
Home Assistant Cloud model.

Self-hosting the Cloud stays possible but costs what v1 costs: your own APNs key and your own build
of the app (Apple ties pushes to the app's key). It's documented, not the default.

The trademark policy (TRADEMARKS.md) keeps the Quai name and logo for the hosted service.

## Nothing stored in the Cloud

The hosted Cloud keeps nothing: no database, nothing on disk, no account. Everything that lasts
lives at home, in the Home's `/data`:

- flows and their settings;
- paired iPhones, their push tokens and preferences;
- the state of running activities, written back as it changes;
- the journal of what Quai did (7 days, at most 5000 lines), handed over in batches every second
  or two: the console's Journal page reads its history from there.

The Home stores and returns these documents without reading them, so it stays dumb. The Cloud
works in memory: when a Home connects, the Cloud loads its home from it; every change is written
back to the Home before it's acknowledged. A restarted Cloud loses nothing, it reloads as Homes
reconnect.

**No accounts.** An iPhone pairs with the Home, as in v1 (QR code from the console). The app then
talks to the Cloud with its home id and device token, and the Cloud checks the token against the
Home. Sign in with Apple and an accounts table aren't needed.

**What we can promise:** nothing about a home is kept by the Cloud; logs carry no titles, names or
tokens. The journal does name titles and iPhones: it is the home's, kept by Quai Home, and the
Cloud only holds its last lines in memory for the console's live view. What we can't: the Cloud sees titles and progress while it computes and pushes them. A
public privacy page says exactly that, and the code is open to check it. Who doesn't want even
that self-hosts the Cloud.

## Security and privacy

- **The *arr keys never leave home.** The Home holds them; the Cloud only asks for calls.
- **The allowlist is in the Home.** A compromised cloud can't delete a library or read config
  endpoints (but Cleanuparr's queue cleaner settings and rules: strike limits and schedule, no
  secret): the Home refuses anything outside it. Writes are limited to the actions the catalog
  and the To fix list offer (Jellyfin play/pause/stop; approving or declining one Seerr request;
  removing one queue item, grabbing one release, `ManualImport`, protecting a Reclaimerr candidate,
  excluding one download from Cleanuparr's queue cleaner), and a write whose path would open
  more (`POST /api/v3/command`) is checked down to its body. A write that replaces a whole
  document (Cleanuparr's queue cleaner settings, which take no partial update) is checked against
  what the service holds: the Home reads it first, and lets it through only if one download id was
  added to its ignore list and nothing else changed.
- **What leaves home:** titles, progress, playback sessions and service health — what a Live
  Activity shows — in transit only (see above). The app's Library tab adds the movie and series
  list (titles, years, public poster URLs, sizes, free disk), read from Radarr and Sonarr through
  the Home when the app asks, never kept. The To fix list adds, the same way, the queue's blocked
  downloads, the titles without a file, release names from the indexers, Reclaimerr's planned
  deletions and Cleanuparr's strikes (release names, their reasons and limits). The journal adds
  what Cleanuparr removed, read from its events every 5 minutes. The Requests tile and flow add Seerr's pending requests (titles, posters, who asked);
  Today's releases, the day's calendar of Sonarr and Radarr. The iPhones' time zone is kept at
  home, on their device documents.
- **Home ↔ cloud:** TLS, one token per Home, issued at linking, revocable from the console.
- **App ↔ Cloud:** the device token the Home issued at pairing, checked against the Home.

## Linking a home

1. The user installs the Home (Umbrel, Docker) with the service keys, as today.
2. On first start the Home creates its home key pair in `/data`. Its home id is the public key's
   fingerprint: the Cloud recognizes a home by proof of the private key (a signed challenge), so it
   needs nothing stored to tell homes apart or to stop one impersonating another.
3. The Home's tile opens the console on the Cloud with a short-lived link the Home signs.
4. In the console, "Pair an iPhone" shows a QR code as in v1; the app scans it, gets its device
   token from the Home and talks to the Cloud from then on, from anywhere.

Several iPhones (Julie's) pair the same way, each with its own preferences.

## What it changes in this repo

| Today | v2 |
| --- | --- |
| `apps/server` | splits into `apps/home` (small: WebSocket, webhook forwarding, allowlisted proxy) and `apps/cloud` (the rest, multi-home) |
| `packages/api` | adds the Home ↔ cloud protocol (Effect `Schema` messages) next to the HTTP contract |
| `src/integrations/*` | move to the Cloud; their HTTP calls go through the Home instead of `fetch` |
| SQLite on `/data` | cloud database (Postgres, or SQLite per home); the Home keeps only its token |
| console served by the server | served by the Cloud, signed in |
| iOS: pairing by QR + LAN URL | sign in, cloud URL; the rest of the app unchanged |
| Umbrel app `mathieu-quai` | becomes the Home: smaller image, same settings, plus the link code |

What carries over unchanged: the catalog, flows, engine, targeting, Live Activity payloads, the
iOS widget, the console UI, and the tests around them.

## Plan

1. **Protocol and Home.** Message schemas; the Home with webhook forwarding and the allowlisted
   proxy; tests with recorded responses.
2. **Cloud, single home first.** Today's server on the protocol: integrations call through the
   Home. Runs against my home to validate.
3. **Multi-home and accounts.** Homes, accounts, linking, per-home data; console signed in.
4. **iOS.** Sign in, cloud URL, invitation of a second iPhone.
5. **Hosting.** Domain, deploy, backups, monitoring; then TestFlight for a few outside testers.

v1 keeps working for me until step 4 ships; then the Umbrel app switches to the Home.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Hosting of the Cloud | A small Node server (VPS or Fly.io) | Runs today's Effect code almost as is; cheap; Cloudflare would mean rewriting for its runtime |
| Accounts | None: iPhones pair with the Home; the Cloud checks tokens against it | The Cloud stores nothing about anyone |
| Storage | All state in the Home's `/data`; the Cloud is memory-only | "We keep nothing" must be true, and checkable in the code |
| How dumb the Home is | Allowlisted proxy | The Home almost never changes; every fix and flow ships from the Cloud |
| Self-hosted all-in-one | Home + Cloud in one compose, pushes through our gateway | Same code as hosted, no second mode to maintain |
| Polling | In the Home, driven by the Cloud's watches | Polling stays on the LAN; what it means stays in the Cloud |
