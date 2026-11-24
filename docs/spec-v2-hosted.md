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
│ - forwards webhooks          │              │ the console's routes (relayed)     │         └──────────┘
│ - runs allowlisted calls     │ ◀─────────── │ APNs (Quai's key)                  │ ──push──▶
│   to Radarr, Sonarr, …       │   requests   │ homes                              │
│ - serves the console         │              │                                    │
└──────────────────────────────┘              └────────────────────────────────────┘
```

**The Home is dumb on purpose.** It knows how to reach the services on the LAN with their keys,
and nothing about Live Activities. It:

1. opens one outbound WebSocket to the Cloud: no port to open, no tunnel, no public URL;
2. forwards webhook payloads (Radarr, Sonarr, Seerr) as they come;
3. runs the HTTP calls the Cloud asks for, within an allowlist of endpoints per service
   (`GET /api/v2/torrents/info`, `POST /Sessions/{id}/Playing/PlayPause`, …), and returns the response.

Everything that can change often (reading a payload, polling, flows, the engine, pushes, what the
console reads and does) lives in the Cloud. The console's pages are served by the Home, which
relays their requests to the Cloud ([ADR 1](adr/0001-console-served-by-quai-home.md)). The Home changes only when a new service, or a new allowlisted
endpoint, comes in. The protocol is versioned, and the Cloud adapts to the Home's version.

**The Cloud** is today's server, made multi-home: integrations, engine, flows, targeting, APNs with
Quai's own key, the console's routes, and the API the app uses. Each home is a tenant.

**The app** talks only to the Cloud: one fixed URL, signed in, reachable everywhere. Pairing
becomes linking a home to an account.

## Names and roles

- **Quai Home** runs at home, next to the services. It holds their keys, sets up their webhooks,
  polls what the Cloud asks it to watch, and forwards what comes in. It knows nothing about Live
  Activities. It serves the console, behind its own password (`QUAI_HOME_PASSWORD`): the
  services' addresses and keys are set there, and stay at home; the rest of the console's
  requests are relayed to the Cloud over the link.
- **Quai Cloud** is the brain: integrations (what an event means), flows, the engine, the console's
  routes, pushes and the app's API. It serves no interface. We host it; it's open source like the
  Home.

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
App Store app signed with Quai's key, which only the hosted Cloud holds: a self-hosted Cloud brings
its own APNs key and its own build of the app. Without them, the App Store app can still pair with
it and act, but gets no pushes and no Live Activities.

A push gateway we host (it would sign a self-hosted Cloud's pushes with Quai's key) is left for
later: it would give away for free what the hosted Cloud sells, and it would need registration,
rate limits and abuse handling around Quai's key. Decided with the paid hosted Cloud.

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

- **The *arr keys never leave home.** The Home holds them (environment variables, or its console's
  Services page, saved in `/data/services.json`); the Cloud only learns which services the home
  reaches, and asks for calls. The keys are typed into a page the Home serves, never one the Cloud
  serves.
- **The console is the Home's.** It asks for `QUAI_HOME_PASSWORD`; the Cloud answers the
  console's routes (`/console-api`) only when the Home relays them, never on its public port.
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
- **Home ↔ cloud:** TLS; the Home proves its home key (Ed25519) by signing the Cloud's challenge
  on each connection. Its home id is the key's fingerprint: nothing to store or issue.
- **App ↔ Cloud:** the device token the Home issued at pairing, checked against the Home.

## Linking a home

1. The user installs the Home (Umbrel, Docker) with the service keys, as today.
2. On first start the Home creates its home key pair in `/data`. Its home id is the public key's
   fingerprint: the Cloud recognizes a home by proof of the private key (a signed challenge), so it
   needs nothing stored to tell homes apart or to stop one impersonating another.
3. The Home's tile opens the console, served by the Home: sign in with `QUAI_HOME_PASSWORD`, set
   the services, then pair an iPhone. `QUAI_CLOUD_URL` names the Cloud; without it the Home runs
   alone and the console says what to set.
4. In the console, "Pair an iPhone" shows a QR code as in v1, carrying the Cloud's address; the
   app scans it, gets its device token from the Home and talks to the Cloud from then on, from
   anywhere. A Home pointed at another Cloud asks for the iPhones to be paired again.

Several iPhones (Julie's) pair the same way, each with its own preferences.

## What it changes in this repo

| Today | v2 |
| --- | --- |
| `apps/server` | splits into `apps/home` (small: WebSocket, webhook forwarding, allowlisted proxy) and `apps/cloud` (the rest, multi-home) |
| `packages/api` | adds the Home ↔ cloud protocol (Effect `Schema` messages) next to the HTTP contract |
| `src/integrations/*` | move to the Cloud; their HTTP calls go through the Home instead of `fetch` |
| SQLite on `/data` | cloud database (Postgres, or SQLite per home); the Home keeps only its token |
| console served by the server | served by Quai Home, signed in with its password; its requests relayed to the Cloud |
| iOS: pairing by QR + LAN URL | sign in, cloud URL; the rest of the app unchanged |
| Umbrel app `mathieu-quai` | becomes the Home and its console: `QUAI_HOME_PASSWORD`, the keys set in the console |

What carries over unchanged: the catalog, flows, engine, targeting, Live Activity payloads, the
iOS widget, the console UI, and the tests around them.

## Plan

1. **Protocol and Home.** Message schemas; the Home with webhook forwarding and the allowlisted
   proxy; tests with recorded responses.
2. **Cloud, single home first.** Today's server on the protocol: integrations call through the
   Home. Runs against my home to validate.
3. **Multi-home.** One Cloud, many homes: each its own services and routes, built when it links
   and forgotten an hour after it went away; an iPhone's token names its home. Done. Accounts
   aren't needed (see "No accounts").
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
| Self-hosted all-in-one | Home + Cloud in one compose, with your own APNs key and build of the app | Same code as hosted, no second mode to maintain; pushes to the App Store app are what the hosted Cloud offers |
| Polling | In the Home, driven by the Cloud's watches | Polling stays on the LAN; what it means stays in the Cloud |
| Where the console lives | Served by the Home, its requests relayed to the Cloud ([ADR 1](adr/0001-console-served-by-quai-home.md)) | One interface; the keys are typed into a page the Cloud never serves |
| Setting the services | The console's Services page, in the Home's `/data`; environment variables still win | Not everyone runs Docker by hand; the keys still never leave home |

## Later: a paid hosted Cloud

The Cloud we host may be paid. Not designed yet; what is decided keeps it possible:

- **The Cloud stores nothing.** A paid Cloud checks a license signed by Quai (home id, expiry),
  sent by the Home in `Hello` and verified with Quai's public key: no database, no call out. What
  knows the subscriptions is a separate billing service, not the Cloud.
- **One `quai` image.** The license check is a variable set on our Cloud only; a self-hosted Cloud
  doesn't set it and stays complete and free.
- **`Welcome` carries what the Cloud requires,** so the Home's console can show "Subscribe" only
  where it applies. Buying from the console (a web page, not the app) keeps App Store purchase
  rules out of it; in-app purchase can come later as a second source of licenses.
- **A push gateway for self-hosted Clouds** (pushes to the App Store app, signed with Quai's key)
  would be part of the offer if it ever exists, not free: it is the hosted Cloud's main value.
