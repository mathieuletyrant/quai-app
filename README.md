<div align="center">

<img src="apps/console/public/icon.svg" width="88" alt="Quai" />

# Quai

**Your Radarr, Sonarr and Jellyfin, live on your iPhone's Lock Screen.**

[![Image](https://img.shields.io/badge/ghcr.io-mathieuletyrant%2Fquai-6FD3C2?logo=docker&logoColor=white)](https://github.com/mathieuletyrant/quai-app/pkgs/container/quai)
![Effect](https://img.shields.io/badge/Effect-4.1-14161c)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Swift](https://img.shields.io/badge/SwiftUI-iOS%2026-f05138?logo=swift&logoColor=white)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/ytrjjGXTKZ)

</div>

<p align="center"><img src="docs/live-activities.png" width="720" alt="Download, Jellyfin playback, a Seerr request and today's releases as Live Activities" /></p>

You request a movie. Quai puts it on your Lock Screen and in the Dynamic Island, and keeps it up
to date while the app is closed: searching, downloading (percent, speed, time left), importing,
ready to watch.

> [!NOTE]
> The iPhone app is free on the [App Store](https://apps.apple.com/app/id6836390669), iPhone only, iOS 26 or later. The next version is on the
> [TestFlight beta](https://testflight.apple.com/join/RpYX68mQ) first.

## ✨ What it does

**Live Activities**
- ⬇️ **Download**: from the request to "ready to watch", with live progress from qBittorrent.
- ▶️ **Playback**: what's playing on Jellyfin, time left, and Play/Pause from the Lock Screen.
- 🙋 **Requests**: a Seerr request waiting for your approval, with Approve and Decline buttons.
- 🗓️ **Upcoming**: what your stack will do on its own, by date: the releases Radarr and Sonarr will grab, the deletions Reclaimerr plans, what Cleanuparr will remove, and the space that really comes back.
- 📅 **Today**: one activity for the day, ticking off today's episodes and movies as they arrive.

You choose which ones run, and what each step shows, in a small flow editor in the web console.

**Alerts**
- 🚨 **Notifications** for what may last: a service that stops answering, the media disk running low, a problem Radarr, Sonarr or Prowlarr report. One when it starts, one when it's over; set up in the console, muted per iPhone.
- 🧹 **Gone**: a notification once Reclaimerr deleted a title (with the space that came back, when it surely did), or Cleanuparr removed a stuck download or cleaned a torrent after seeding. Off until turned on, per iPhone.

The app is for living with Quai, the console for setting it up: services, flows and iPhones, plus the alerts and the journal of what Quai did.

**The app**
- 🏠 **Home**: what to fix, requests waiting for you, what's coming, the alerts and how full the disk is. What plays and downloads follows you in a bar above the tabs, like Music's mini player.
- 🎞️ **Library**: your movies and series with their posters, and what's still missing.
- 🛠️ **To fix**: blocked imports (remove or import anyway), titles with no release (search and pick
  one), what Reclaimerr is about to delete and what Cleanuparr is about to take out of the queue
  (keep it, or let it go).
- 🔎 **Search**: type or say a title, pick it among Seerr's results, request it (a series asks
  which seasons). A Lock Screen control opens it already listening, a Lock Screen widget with the
  keyboard up. Each iPhone chooses the Seerr user it requests as, in Settings.

## 🧭 How it works

Quai has two parts.

- 🏠 **Quai Home** runs next to your services, on your server. It holds their API keys and your data
  (paired iPhones, flows, preferences). It sets up the Radarr and Sonarr webhooks, polls only
  what's needed, and makes only the calls on a fixed allowlist. It connects out: no port to open.
- ☁️ **Quai Cloud** turns what Home sends into Live Activities and pushes them through Apple. It
  stores nothing: when Home connects, Cloud loads what it needs from it.

```
 your server                                   anywhere
┌───────────────────────────────┐         ┌─────────────────┐          ┌────────┐
│ Radarr · Sonarr · qBittorrent │         │                 │  Apple   │        │
│ Jellyfin · Seerr · Reclaimerr │         │   Quai Cloud    │ ───────▶ │ iPhone │
│ Cleanuparr                    │         │                 │          │        │
│              ▲                │ ──────▶ │ (stores nothing)│ ◀─────── │        │
│              │                │ ◀────── │                 │   app    │        │
│          Quai Home            │         └─────────────────┘          └────────┘
│      (your keys, your data)   │
└───────────────────────────────┘
```

A Play/Pause tap on the Lock Screen goes iPhone → Cloud → Home, and Home calls Jellyfin.

Today both parts run on your own server. A hosted Cloud, so you only run Home, is planned
([spec](docs/spec-v2-hosted.md)).

## 🚀 Install

☂️ **Umbrel**: install **Quai** from [Mathieu's Umbrel App Store](https://github.com/mathieuletyrant/umbrel-community-app-store),
open it, set the services' addresses and keys in its **Services** page, and scan the QR code with the iPhone.

🐳 **Docker**: run both images side by side.

```yaml
services:
  cloud:
    image: ghcr.io/mathieuletyrant/quai:latest
    ports: ["8787:8787"]
    environment:
      QUAI_APNS_KEY_FILE: /keys/AuthKey.p8
      QUAI_APNS_KEY_ID: ABCDE12345
      QUAI_APNS_TEAM_ID: FGHIJ67890
    volumes: ["./keys:/keys:ro"]
  home:
    image: ghcr.io/mathieuletyrant/quai-home:latest
    ports: ["8788:8788"]
    environment:
      QUAI_CLOUD_URL: ws://cloud:8787/home
      QUAI_CLOUD_APP_URL: http://<server>:8787
      QUAI_HOME_PASSWORD: change-me
      QUAI_INTERNAL_URL: http://home:8788
    volumes: ["./data:/data"]
```

Then open the console at `http://<server>:8788`, sign in with `QUAI_HOME_PASSWORD`, set the
services' addresses and keys in **Services** (they stay in Quai Home's `/data`, never sent to Quai
Cloud), then choose **Pair an iPhone** and scan the code.

Live Activities need an Apple push key, and Apple only accepts pushes signed with the key of the
app's own developer account. Until the hosted Cloud exists, self-hosting means building the app with
your own account.

<details>
<summary>All settings</summary>

**Quai Home**

| Env | |
|---|---|
| `QUAI_CLOUD_URL` | The Cloud's WebSocket, e.g. `ws://cloud:8787/home`. Without it Quai Home runs alone, and its console says what to set |
| `QUAI_CLOUD_APP_URL` | Where the iPhone reaches Quai Cloud at home, for the pairing QR code, when `QUAI_CLOUD_URL` is an address only Home reaches (`http://server:8787`). Default: `QUAI_CLOUD_URL` in http(s) |
| `QUAI_HOME_PASSWORD` | The console's password. Without it the console stays locked |
| `QUAI_HOME_PORT` | The console, the webhooks and `/health` (default `8788`) |
| `QUAI_CONSOLE_PUBLIC_URL` | The console's address from outside, behind your own proxy or tunnel. Added to the pairing QR code: the app's "Open the console" opens it when the console's address at home doesn't answer |
| `QUAI_INTERNAL_URL` | How Radarr and Sonarr reach Home, for the webhooks it sets up |
| `QUAI_DATA_DIR` | Where Home keeps its data (default `./data`, `/data` in the image) |
| `QUAI_RADARR_URL`, `QUAI_RADARR_API_KEY` | Radarr (Settings → General). Each service can be set in the console's Services page instead; a variable set here wins |
| `QUAI_SONARR_URL`, `QUAI_SONARR_API_KEY` | Sonarr (Settings → General) |
| `QUAI_RADARR_WEB_URL`, `QUAI_RADARR_PUBLIC_URL` | Optional: where an iPhone opens Radarr, at home and from outside. The app's Library links each movie to its page, at the one that matches where the iPhone reaches Quai |
| `QUAI_SONARR_WEB_URL`, `QUAI_SONARR_PUBLIC_URL` | The same for Sonarr and the series |
| `QUAI_JELLYFIN_URL`, `QUAI_JELLYFIN_API_KEY` | Jellyfin (Dashboard → API Keys) |
| `QUAI_QBITTORRENT_URL`, `QUAI_QBITTORRENT_USERNAME`, `QUAI_QBITTORRENT_PASSWORD` | qBittorrent Web UI |
| `QUAI_SEERR_URL`, `QUAI_SEERR_API_KEY` | Seerr, Jellyseerr or Overseerr (Settings → General) |
| `QUAI_PROWLARR_URL`, `QUAI_PROWLARR_API_KEY` | Prowlarr (Settings → General), for the alerts only |
| `QUAI_RECLAIMERR_URL`, `QUAI_RECLAIMERR_API_KEY` | Reclaimerr (Settings → Integrations; scopes `candidates:manage`, `system:read`, `events:read` for Gone, and `tasks:read` for when it deletes) |
| `QUAI_CLEANUPARR_URL`, `QUAI_CLEANUPARR_API_KEY` | Cleanuparr (Settings → Account); on Umbrel `http://mathieu-cleanuparr_server_1:11011` |

A service set neither here nor in the console's Services page is skipped.

**Quai Cloud**

| Env | Default | |
|---|---|---|
| `QUAI_PORT` | `8787` | The app's API and the `/home` WebSocket (the console is Quai Home's) |
| `QUAI_APNS_KEY_FILE` (or `QUAI_APNS_KEY`), `QUAI_APNS_KEY_ID`, `QUAI_APNS_TEAM_ID` | | Apple push key (.p8) |
| `QUAI_APNS_TOPIC` | `com.mathieuletyrant.quai` | The app's bundle id |
| `QUAI_CLOUD_PUBLIC_URL` | | Address from outside, added to the pairing QR code |
| `QUAI_CLOUD_PUBLIC_HEADERS` | | Headers your reverse proxy requires from the app ([docs](docs/proxy.md)) |
| `QUAI_TZ` | `UTC` | Time zone for "today", until an iPhone reports its own |
| `QUAI_HOME_ID` | | The only Quai Homes served, comma-separated (the id each logs as `linked as home …`); any other is refused ([docs](docs/proxy.md#quai_home_id)) |
| `QUAI_MAX_HOMES` | | How many Quai Homes may be linked at once; past it, a new one is refused |

</details>

## 🛠️ Develop

```sh
pnpm install
pnpm dev:cloud     # Quai Cloud on :8787
QUAI_CLOUD_URL=ws://localhost:8787/home QUAI_HOME_PASSWORD=dev pnpm dev:home   # Quai Home on :8788
pnpm dev:console   # console on :5173, through Quai Home
pnpm --filter @quai/site dev   # the website on :8790
pnpm check && pnpm test
```

| Path | |
|---|---|
| `packages/api` | The contract (Effect `HttpApi` + `Schema`), exported as `openapi.json` |
| `apps/home` | Quai Home |
| `apps/cloud` | Quai Cloud (Effect on Node) |
| `apps/console` | Web console (React, Vite), served by Quai Home |
| `apps/site` | The website: landing, privacy policy, support (static HTML) |
| `apps/ios` | iPhone app and Live Activities (SwiftUI, XcodeGen) |

iOS: `cd apps/ios && xcodegen generate && open Quai.xcodeproj`.

Releases are automatic from [Conventional Commits](https://www.conventionalcommits.org): merging
the release PR publishes the Docker images and uploads the app to TestFlight.

📖 More: [flows](docs/flows.md) · [Home and Cloud](docs/spec-v2-hosted.md) · [behind a proxy](docs/proxy.md) · [rules for coding agents](AGENTS.md)

## 📄 License

[Apache 2.0](LICENSE). The **Quai** name and logo aren't covered by it ([TRADEMARKS.md](TRADEMARKS.md)):
a fork you ship to others needs its own name, logo and bundle id.
