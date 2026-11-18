<div align="center">

<img src="apps/console/public/icon.svg" width="96" alt="Quai" />

# Quai

**Your self-hosted media stack, live on your iPhone.**
Every movie or series followed from request to "ready to watch", on the Lock Screen and in the Dynamic Island.

[![Image](https://img.shields.io/badge/ghcr.io-mathieuletyrant%2Fquai-f2b45a?logo=docker&logoColor=white)](https://github.com/mathieuletyrant/quai-app/pkgs/container/quai)
![Effect](https://img.shields.io/badge/Effect-4.1-14161c)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Swift](https://img.shields.io/badge/SwiftUI-iOS%2026-f05138?logo=swift&logoColor=white)

</div>

> [!NOTE]
> Early days. The server, console and iOS app are scaffolded; the first Live Activity (Download) is the next milestone.

## ✨ Features

**Live Activities**, started remotely by the server, with the app closed:

- ⬇️ **Download**: search, download (%, speed, time left), import, French subtitles, available. Then "Play on TV" for 15 min
- ▶️ **Jellyfin playback**: title, time left, end time, on the devices you pick
- 📅 **Today's releases**: what airs today with a countdown, ticked off once grabbed
- 🚨 **Server incident**: a service, indexer or disk down, since when, what's waiting

**Server**

- 🔌 Reads Radarr, Sonarr, Prowlarr, Bazarr, qBittorrent, Seerr and Jellyfin over your Docker network
- 🪝 Sets up its own webhooks, polls only while an activity needs it
- 🔒 Local first: nothing leaves the machine but the pushes to Apple; no port to open
- 🖥️ Web console: guided setup, Live Activity rules, paired iPhones, event log

**iPhone app**

- 📷 Pair by scanning a QR code from the console
- 📋 Live activities first, then today's events
- 🎚️ One switch per activity kind, greyed out when the admin turned it off

## 🚀 Run it

```sh
docker run -d --name quai -p 8787:8787 -v ./data:/data \
  --network <your-arr-network> \
  ghcr.io/mathieuletyrant/quai:latest
```

Open http://localhost:8787. Quai must share a Docker network with the *arr apps so it can reach them by container name. See [`docker-compose.example.yml`](docker-compose.example.yml).

| Env | Default | |
|---|---|---|
| `QUAI_PORT` | `8787` | HTTP port (API + console) |
| `QUAI_DATA_DIR` | `/data` | SQLite database and encrypted secrets |
| `QUAI_CONSOLE_DIR` | `/app/console` | Built console served by the server |

The image is multi-arch (amd64 / arm64), tagged `latest`, `x.y` and `x.y.z`.

On Umbrel, install **Quai** from [Mathieu's Umbrel App Store](https://github.com/mathieuletyrant/umbrel-community-app-store).

## 🛠️ Develop

```sh
pnpm install
pnpm dev:server      # API on :8787
pnpm dev:console     # console on http://localhost:5173
pnpm test
pnpm check
pnpm gen:openapi     # after changing packages/api
```

```
packages/api     The contract: Effect HttpApi + Schema, exported as openapi.json
apps/server      Effect 4 on Node: *arr adapters, activity engine, APNs over HTTP/2
apps/console     React · Vite, typed client derived from packages/api
apps/ios         SwiftUI · WidgetKit Live Activities · App Intents (XcodeGen project.yml)
```

One contract, three consumers: changing a route in `packages/api` breaks the server, the console and the iOS app at compile time.

iOS (macOS): `cd apps/ios && xcodegen generate && open Quai.xcodeproj`. The **Quai Demo** scheme starts a demo Live Activity without a server.

### 📦 Releases

Fully automatic, driven by [Conventional Commits](https://www.conventionalcommits.org) (`feat:` → minor, `fix:` → patch):

1. Every push to `main` opens or updates a **release PR** with the next version and the CHANGELOG.
2. Merging it creates the tag and GitHub release, then builds and publishes the Docker image.

📖 Spec: [docs/spec-v1.md](docs/spec-v1.md) · 🤖 Agent rules: [AGENTS.md](AGENTS.md)
