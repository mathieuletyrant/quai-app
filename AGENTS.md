# AGENTS.md

Rules for agents working on Quai. Read the specs before building a feature: [`docs/spec-v1.md`](docs/spec-v1.md) (product) and [`docs/spec-v2-hosted.md`](docs/spec-v2-hosted.md) (Quai Home and Quai Cloud). Name things as [`GLOSSARY.md`](GLOSSARY.md) does.

## Layout

| Path | Role |
| --- | --- |
| `packages/api` | The contract: Effect `HttpApi` + `Schema`. Single source of truth for routes and types. Generates `openapi.json`. |
| `apps/home` | Quai Home: runs next to the services with their keys, links to Quai Cloud over a WebSocket, runs its allowlisted calls and watches, keeps the home's documents. |
| `apps/cloud` | Quai Cloud, Effect on Node: implements the contract, reads what Quai Home forwards, runs the flows, pushes to APNs, serves the console. Keeps nothing: the home's data lives in Quai Home. |
| `apps/console` | React + Vite web console, with a typed client derived from `packages/api`. |
| `apps/ios` | SwiftUI app + widget extension (Live Activities). XcodeGen project (`project.yml`), client generated from `openapi.json`. |
| `Dockerfile` | The two server deliverables, one build: `--target home` and `--target cloud` (default). |

## Host-agnostic

- Quai ships **two generic Docker images**, `quai-home` and `quai` (the Cloud). No code, type or route may assume Umbrel or any other host.
- Quai Cloud stores nothing about a home: no database, nothing on disk. A home's data lives in Quai Home, behind the home store.
- The contract (`packages/api`) only talks about Quai: *arr services, activities, devices. Never the host.
- All configuration comes from `QUAI_*` environment variables and the `/data` volume.
- The Umbrel packaging lives in `mathieuletyrant/umbrel-community-app-store` (`mathieu-quai`), not here.

## Language

Everything in the repo is in English: code, comments, UI strings, docs, commit messages.

## Effect

- `effect` and `@effect/*` are pinned to **4.1.4** through the `catalog:` in `pnpm-workspace.yaml`. Never bump them unasked: `effect/http`, `effect/http-api` and `effect/sql` are marked unstable.
- Reference docs: https://effect.website/llms.txt (v4). When unsure of a signature, read the `.d.ts` files in `node_modules/effect/dist/`.
- One service = one `Context.Service` + one `Layer` (`static readonly layer`). The Cloud never calls a service itself: its calls go through `HomeReads` (offline is 503, a service that didn't answer is unavailable), its watches through `HomeLink`.
- Each service's events (webhook or polling) and actions live in one integration module, `apps/cloud/src/integrations/<service>.ts` (see [`docs/flows.md`](docs/flows.md#integrations)).
- Errors: `Data.TaggedError` (or `Schema.TaggedError` when they cross the API). No `throw`.
- No bare `Promise` or `async` on the server: everything is an `Effect`. `Promise` is only allowed at the console's React boundary.
- Time goes through `Clock` (never `Date.now()` in logic) so `TestClock` works. One exception: the start time in `ServerInfo.layer`.
- In `HttpApiBuilder.group`, get services in the outer `Effect.gen`, not inside each handler.

## Server

- A read is defined once, as a `Read<A>` (service, path, schema): `HomeReads` reads it when the app asks, `watchOf` makes its watch, `readSnapshot` decodes its snapshots (`dayReads`, `pendingRead`). Never a second path or decode for the same GET.
- One adapter per media kind, not branches on the service: movies (Radarr) and series (Sonarr) each implement `MediaFixes` (`fixes/movies.ts`, `fixes/series.ts`); `Fixes.ts` only orchestrates. A new kind or rule goes in its adapter, a target carries only its own kind's fields, and what can be decided without a call is a pure function with its own test.
- An id the server mints and reads back is made and parsed in one module (`fixes/FixId.ts`), never by string prefixes elsewhere.
- One decision per action: the HTTP route and the Live Activity button call the same service function (`Seerr.decide`), which checks the state it acts on; each caller only maps its errors and refreshes the Hub.
- Shared *arr helpers (images, dates, years, queue, releases, manual import) live in `integrations/arr.ts`, not in one service's module.

## iOS

- Quai's refusals become a `ConnectionError` in `QuaiErrorsMiddleware` only (from the answer's `_tag` and `message`), proxy refusals in `AccessHeadersMiddleware`. A call reads only its success with the generated throwing accessors (`try await client.listFixes().ok.body.json`, `.noContent`): no `switch` over an `Output`, no error message per route.

## Console

`apps/console/src` (React 19, Tailwind v4). A page reads as a short list of sections; the look lives in `ui/`.

- **The app to live with Quai, the console to set it up.** The console only has setup pages (Settings, Flows, iPhones). What's used day to day (requests, fixes, today's releases, the library) lives in the iOS app only: no console page, no `/console-api` route for it.
- `ui/` is the single source of the look, one file per job (buttons, layout, feedback, forms, menus, status, table, icons), re-exported by `ui/index.ts`: import `from "../ui"`. A page that needs a new look adds or extends a `ui/` component; delete what nothing imports.
- Loading, offline, failed and ready go through one primitive: read with `useLoad` (`load.ts`), show with `<Async state loading offline failed>{(data) => …}</Async>`, report with `<ErrorCallout unlessOffline>`. Data-specific states (empty, not configured) are early returns in the component that gets the data. No ternary chains for states.
- Rows and items are named components with explicit props (`DeviceName`, `StepNode`).
- Theme tokens only: colours, the type scale (`text-caption`, `text-body`, `text-subhead`…), tracking, radii and shadows are `@theme` tokens in `styles.css`. No arbitrary `[#hex]`, `text-[Npx]` or `rounded-[Npx]`; add a token instead. Arbitrary values are kept for one-off layout calcs (`grid-cols-[minmax(0,1fr)_300px]`, `h-[calc(100vh-4rem)]`). In JS styles use `var(--color-…)`; hex only for data (a flow's colour) or a library that takes hex.
- Text and logic stay out of the markup: subtitles, facts and labels are small named functions next to the page, or in `format.ts` when pages share them (`duration`, `shortMinutes`). No multi-line expressions in props.

## Tests

- **No feature merged without its test.**
- `@effect/vitest` (`it.effect`); move time with `TestClock.adjust`, never real waits.
- Routes: `HttpApiTest.groups(QuaiApi, [...])` with `NodeHttpServer.layerTest`.
- Quai Home in Cloud tests: `makeFakeHome` with `recordedHome(routes, overrides)` (`"radarr GET /api/v3/queue"` → fixture). It enforces the real allowlist and fails the test on a refused call or watch.
- *arr adapters: recorded real responses (fixtures), never calls to the real stack.
- Contract: a test checks `openapi.json`. After changing `packages/api`, run `pnpm gen:openapi` and commit the file.

## Commits and releases

[Conventional Commits](https://www.conventionalcommits.org): `feat:` → minor, `fix:` → patch, `chore:`/`docs:`/`refactor:` → no release. release-please turns `main` into a release PR; merging it tags, releases and publishes `ghcr.io/mathieuletyrant/quai`.

## Commands

```sh
pnpm install
pnpm check        # tsc in every package
pnpm test         # vitest in every package
pnpm gen:openapi  # regenerate packages/api/openapi.json
pnpm dev:cloud    # Quai Cloud on :8787
pnpm dev:console  # console on :5173 (proxies /api to :8787)
```

iOS (macOS): `cd apps/ios && xcodegen generate && open Quai.xcodeproj`.

## Before finishing a task

`pnpm check && pnpm test` pass. If `packages/api` changed, `openapi.json` is regenerated and committed.
