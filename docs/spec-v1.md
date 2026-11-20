# Quai — product spec v1

Nov 18, 2026 · Mathieu Le Tyrant

## Summary

Quai is the iPhone and real-time layer of a self-hosted media stack: it follows every movie or series from the request to "ready to watch" on the Lock Screen, and flags what is stuck with a one-tap fix.

It has two parts: a local server, shipped as a generic Docker image and installed next to the \*arr apps (at home: on Umbrel, through my app store), and a native iOS app. The server listens to the stack and pushes to the iPhone; the app shows, and acts in one tap. No AI and no MCP in v1.

## Problem and positioning

The \*arr apps work silently: you don't know a movie is ready, an import is stuck or a deletion is scheduled without opening five web UIs. The household requests movies without knowing when they will arrive.

| Alternative | What it does well | What it cannot do |
| --- | --- | --- |
| Helmarr | Native iOS client for the whole stack (library, queue, calendar, widgets) | Nothing while the app is closed: no server, so no push and no Live Activity |
| Claude (or another agent) + arr-mcp | Act and explain in natural language | Be on the iPhone without being opened, react continuously to events |
| Spotarr | Link sharing, automatic adds to Seerr by rules | Following up after the add |
| Home Assistant companion app | Generic Live Activities | Understand a title's journey through the stack |

Quai does not rebuild the library client. Its place: **the server that watches, and the iPhone that shows and fixes**.

**The household:**

| Person | Role | Usage |
| --- | --- | --- |
| Mathieu | Admin | Installs, configures the console, receives everything, fixes problems |
| Julie | Member | No account of her own: uses Mathieu's Jellyfin account; receives the Live Activities enabled on her iPhone |
| Tania | Guest | Watches on Jellyfin, no Quai app |

## v1 scope

v1 only ships Live Activities, with the bare minimum around them: the server, the setup, and a minimal iOS app to connect and configure activities.

**In v1**

- Quai server: service discovery, webhooks, polling, sending pushes to Apple
- Live Activities: download, Jellyfin playback, today's releases, server incident
- iOS app: server connection, list of running activities, Live Activity settings
- Web console: guided setup, Live Activities, household, devices, log, settings
- Services read: Radarr, Sonarr, Prowlarr, Bazarr, qBittorrent, Seerr, Jellyfin
- Install: a generic Docker image, configured through environment variables; the Umbrel app is only a manifest pointing to it, in the store repo

**Later (v2 and after)**

- To fix: fixed rules and one-tap fixes (with Cleanuparr, Reclaimerr, Profilarr)
- Widgets, Siri and Shortcuts
- Tiled home, library, search and add, title page
- "Request to approve" Live Activity (useless while the whole household is auto-approved)

**Out of scope**

- Built-in AI agent and MCP server: a general-purpose agent does better, Quai adds nothing there
- Home Assistant and the house
- Link sharing and rule-based adds: that's Spotarr; its adds go through Seerr, so Quai follows them without an integration
- Video playback in the app, Android, Plex and Emby

## Live Activities

Four kinds in v1, all started remotely by the server (push-to-start), without the app being open. Each has a Lock Screen banner and three Dynamic Island states (expanded, compact, minimal), as in the mockups.

| Kind | Starts when | Shows | Ends when | Options |
| --- | --- | --- | --- | --- |
| Download | A title is added in Seerr, Radarr or Sonarr (Spotarr rules included) | Steps: searching, downloading (%, speed, time left), importing, French subtitles, available | Available in Jellyfin, then stays 15 min with "Play on Living Room TV" | Steps shown; duration after the end |
| Jellyfin playback | Playback starts on a chosen device | Title, time left (native timer), end time | Playback ends, or 15 min without playback | Which Jellyfin devices |
| Today's releases | At the chosen time, if followed releases air today | Today's list with countdown, then a tick once grabbed | Everything grabbed, or midnight | Start time; chosen series |
| Server incident | A health check fails (service, indexer, disk) | Service, since when, pending searches | Back to normal: green tick for a few minutes | Delay before alerting (5 min by default) |

**Two-level settings**

1. Console (admin): each kind enabled or not, its triggers, its steps, and who may receive it. Recipients are iPhones, not accounts: Julie shares Mathieu's Jellyfin account, so Quai cannot tell who requested what. Tania has no app.
2. App (each person): one switch per kind and the kind's own option. A kind turned off in the console is greyed out in the app.

**Common behaviour**

- One title = one activity, even when several services talk about it: the key is the TMDB/TVDB id, plus the torrent id while downloading.
- Several activities of the same kind at once: one per title, within Apple's limit; beyond it, one grouped activity "3 downloads".
- A download with no source for 2 h turns grey with "Other release".
- A tap opens the app on the activity list; the end button opens Jellyfin on the title.
- Buttons (Play, Other release, Retry) run without opening the app, through App Intents.

## iOS app v1

In v1 the app does three things: link to the server, show running activities, choose what you receive. It does not replace Jellyfin or Seerr.

| Screen | Content | Mockup |
| --- | --- | --- |
| Connect | Scan the console's QR code, or type the address; local connection on Wi-Fi, otherwise the public address behind Cloudflare Access; Live Activity and notification permissions | App · Connect to server |
| Activity | Running activities first, then today's event feed (adds, grabs, imports, incidents) | App · Activity |
| Settings | Server and connection, Live Activities, notifications, accent colour | App · Settings |
| Settings · Live Activities | One switch and one option per kind; kinds turned off by the admin greyed out | App · Settings · Live Activities |

Navigation: two tabs (Activity, Settings) in iOS's floating tab bar. Dark by default, accent colour of your choice.

## Web service

The console runs on the Quai server: it is where the admin installs, connects services and decides what goes to the iPhones. No account to create: access is protected by the host locally (Umbrel's proxy at home) and by Cloudflare Access remotely.

**Guided setup, in 4 steps**

1. **Server**: Quai shows which Docker network it runs on and what it sees there; no particular host is assumed.
2. **Services**: list of services found, with their internal address and API key; Quai sets up its own webhooks in Radarr, Sonarr, Prowlarr and Seerr.
3. **Away from home**: Cloudflare tunnel detected (publishing `quai.cheztomy.cc` behind Access), VPN, or home only.
4. **iPhone**: single-use QR code, valid 10 minutes; one code per iPhone.

**Console**

| Page | Content |
| --- | --- |
| Overview | Service status, running activities, devices, Live Activity rules |
| Services | Version, internal address, what Quai receives (webhook or polling), response time, disk |
| Live Activities | Per kind: enabled, triggers, steps shown, recipient iPhones, end |
| Devices | Each paired iPhone (name, permissions, running activities), test push, removal, new QR code |
| Log | Webhooks received, pushes sent, actions, errors; filters and search |
| Settings | Apple push key, remote access, default appearance, backup, removing Quai |

The mockups' Household page is not needed in v1: without separate accounts, everything is per iPhone.

## Data flow

Step changes arrive through webhooks; Quai only polls a service while an activity needs it, and it alone talks to Apple.

&#91;embedded content: flow of an event · 5 sources, 3 stages, 1 output to Apple\]

Everything travels on the host's internal Docker network: services call Quai by its container name. The app and the console read the server directly, locally or through `quai.cheztomy.cc`.

## Technical architecture

One monorepo, one API contract written once in Effect 4: the server implements it, the console imports it in TypeScript, the iOS app gets it as a Swift client generated from its OpenAPI. Effect fits, provided the coding agent is kept on rails.

&#91;embedded content: monorepo · one contract, three consumers\]

Changing a route in `packages/api` breaks the server, the console and the app at compile time, in the same place: that is the main safeguard of an agent-coded project.

| Piece | Choice | Why |
| --- | --- | --- |
| Contract | `packages/api`: Effect `HttpApi` + `Schema` | One definition of routes and types; OpenAPI generated for Swift |
| Server | `apps/server`: Effect 4 on Node (`@effect/platform-node`) | Typed errors, a `Layer` per \*arr service, `Schedule` for polling and retries |
| Database | SQLite (`@effect/sql-sqlite-node`), queries with Effect's `SqlClient` (`effect/sql`) | One file, nothing to install; no ORM. `@effect/sql-kysely` has no v4 release (last version 0.48, for Effect 3) |
| Push | Effect service around `node:http2` + JWT from the .p8 key | APNs requires HTTP/2, which Node's `fetch` does not speak. Development APNs server for builds installed from Xcode, production for TestFlight: the server must know which one to target for each iPhone |
| Console | `apps/console`: React + Vite, served by the server | Typed client derived from `packages/api` |
| iOS app | `apps/ios`: SwiftUI, widget extension (Live Activities), App Intents | Project described in YAML (XcodeGen) to avoid `.xcodeproj` conflicts |
| Swift client | `swift-openapi-generator` on the contract's OpenAPI | No hand-written Swift models |
| Delivery | `Dockerfile` at the root: one generic image (server + console) | Host-agnostic; the Umbrel manifest `mathieu-quai` lives in `umbrel-community-app-store` and points to the image |

**Keeping vibe coding with Effect on rails**

- Pin the exact Effect 4 version: HTTP, HttpApi and SQL are "unstable" modules that can change between minor versions. Give the agent the v4 docs: [effect.website/llms.txt](https://effect.website/llms.txt) and an Effect skill in the repo.
- An `AGENTS.md` that sets the patterns: one `Layer` per service, errors as `Data.TaggedError`, no bare `Promise`.
- Tests with `@effect/vitest` on recorded Radarr, Sonarr and Seerr responses, to replay a journey without touching the real stack.
- On iOS, an Xcode scheme that starts a demo Live Activity, to iterate on the UI without a server.

## Tests

The core to protect is the activity engine: a given sequence of events must always produce the same sequence of pushes. Tests are the safeguard of an agent-coded project: a rule in `AGENTS.md`, no feature merged without its test.

| Level | What we check | How |
| --- | --- | --- |
| Contract | Schemas decode and re-encode losslessly; the OpenAPI does not change by accident | `@effect/vitest`, `openapi.json` snapshot |
| Adapters | Every webhook and API response from Radarr, Sonarr, Prowlarr, Seerr, qBittorrent, Bazarr and Jellyfin is read correctly | Recorded real responses (fixtures), one set per service version |
| Activity engine | Full scenarios: add → grab → progress → import → available; duplicates merged; "no source for 2 h"; missed webhook caught up | Scenarios replayed with Effect's `TestClock` to move time without waiting |
| Push | Right environment (development or production), right push type, at most one data send every 5 s per activity | Fake local HTTP/2 APNs server that records every send |
| Console | Guided setup end to end | Playwright against fake services |
| iOS app | State decoding; rendering of each Live Activity (Lock Screen, Dynamic Island expanded, compact, minimal) | Swift Testing; image snapshot tests on typical states |

**Real fixtures.** A `record-fixtures` script reads your stack read-only and records the responses, with keys and file names masked. When a service changes version, re-record and the differences stand out.

**Continuous integration.** TypeScript tests on every pull request; iOS build and tests on a macOS runner, only when `apps/ios` or `packages/api` changes, to limit billed minutes.

## Non-functional requirements

- **Local first.** The server talks to services over the machine's internal network. Nothing leaves, except pushes to Apple and the app when you are away.
- **No port to open.** Webhooks arrive internally; remote access goes through the existing tunnel.
- **Secrets.** API keys and the push key are stored encrypted on the server, never sent back in clear to the app or the console. The app holds no service key.
- **Read-only by default.** In v1, Quai only writes twice: setting up and removing its webhooks. The action buttons (other release, retry) are the only other writes.
- **Push budget.** Updates on step changes, and at most one every 5 s while downloading; playback time left runs on the iPhone.
- **Frugal.** Polling only while an activity needs it; target: under 100 MB of memory and near-zero idle CPU on an N100.
- **Reliable.** A missed webhook is caught up by reading the state on reconnection; a silent service does not block the others.
- **Clean removal.** Uninstalling Quai removes its webhooks and unlinks the iPhones.

## Milestones

The first milestone that matters is #2: a real Download Live Activity, from the add to "ready", on your iPhone.

1. **Apple prerequisites**: developer account, app identifier, push key (.p8). Done when a test push reaches the iPhone.
2. **Download end to end**: monorepo, server reading Radarr, Sonarr, qBittorrent and Jellyfin, app with QR code pairing, Download Live Activity. Done when an add in Seerr reaches "ready" without touching anything.
3. **The other three kinds**: Jellyfin playback, server incident, today's releases.
4. **Console and settings**: full guided setup, Live Activities, Devices and Log pages; settings in the app.
5. **Go live**: image published on GHCR, app in my Umbrel store (`mathieu-quai`), installed from Xcode on my iPhone and Julie's over USB, then TestFlight, two weeks of real use before starting v2.

## Later

These pieces are designed but wait for v2, in this order:

1. **To fix**: fixed rules (import stuck, no source, no file after release, missing French subtitles, deletions scheduled by Cleanuparr or Reclaimerr, low disk), each with its one-tap fix.
2. **Widgets, Siri and Shortcuts**: Home Screen, Lock Screen, StandBy; "Add Dune", "What's out tonight?".
3. **Tiled home, library, search and add, title page** with the title's journey.

## Open questions

- [ ] **Name**: Quai, Lanterne, Ouvreuse? Check the App Store and domain names.
- [x] **Effect v4**: pinned to 4.1.4. No Kysely integration in v4 → queries with Effect's SQL. HTTP and HttpApi live in `effect/http` and `effect/http-api`, still marked unstable.
- [ ] **Service discovery**: read the Docker socket read-only (sensitive access) or probe known ports on the machine's IP?
- [ ] **Jellyfin**: official Webhook plugin or polling sessions? Polling avoids a plugin to install.
- [ ] **French subtitles**: trust Bazarr's history, or read the file's tracks in Jellyfin?
- [ ] **Concurrent activity limit**: from how many downloads to group them into one activity?
- [ ] **Sharing beyond the household**: pushes to the distributed app can only be signed with its owner's APNs key, so another person's Quai server can't reach it. Either a hosted push relay (it holds the key, each server registers and is rate-limited; it sees titles, as Live Activity payloads are clear text), or everyone builds their own app with their own developer account. Until then, Quai is for the household only.
- [ ] **Distribution**: first from Xcode over USB, then TestFlight. Public App Store: not before living with the app.
