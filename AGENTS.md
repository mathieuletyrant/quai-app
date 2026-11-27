# AGENTS.md

Rules for agents working on Quai. Read the specs before building a feature: [`docs/spec-v1.md`](docs/spec-v1.md) (product) and [`docs/spec-v2-hosted.md`](docs/spec-v2-hosted.md) (Quai Home and Quai Cloud). Name things as [`GLOSSARY.md`](GLOSSARY.md) does.

## Layout

| Path | Role |
| --- | --- |
| `packages/api` | The contract: Effect `HttpApi` + `Schema`. Single source of truth for routes and types. Generates `openapi.json`. |
| `packages/domain` | The domain: everything Quai does for one home (integrations, flows and engine, alerts, journal, the app's pages and their routes), on a home link. Quai Cloud runs it today; Quai Home will ([ADR 3](docs/adr/0003-quai-home-runs-quai.md)). |
| `apps/home` | Quai Home: runs next to the services with their keys (environment, or the console's Services page in `/data`), links to Quai Cloud over a WebSocket, runs its allowlisted calls and watches, keeps the home's documents, serves the console behind `QUAI_HOME_PASSWORD` and relays its `/console-api` requests to the Cloud. |
| `apps/cloud` | Quai Cloud, Effect on Node, one for many homes: implements the contract, reads what Quai Home forwards, runs the flows, pushes to APNs, answers the console's routes Quai Home relays (never on its public port). No interface, keeps nothing: the home's data lives in Quai Home. |
| `apps/console` | React + Vite web console, served by Quai Home, with typed clients derived from `packages/api` (`QuaiApi` relayed to the Cloud, `HomeConsoleApi` Quai Home's own). |
| `apps/site` | The public website (landing, privacy policy, support): static HTML in `public/`, no build. The `site` workflow deploys it on each push to `main` as a Worker with static assets (`wrangler.jsonc`, custom domain `quai.stream`, `_headers` for its headers); it needs the `CLOUDFLARE_API_TOKEN` secret. Fonts are self-hosted: the pages load nothing from another site but Cloudflare Web Analytics' beacon (no cookies), which `_headers`' CSP and the privacy policy's "This website" allow. `pnpm --filter @quai/site dev` serves it on :8790. |
| `apps/ios` | SwiftUI app + widget extension (Live Activities). XcodeGen project (`project.yml`), client generated from `openapi.json` into `Quai/Generated`, not committed: the CI's `ios-client` job makes it, `pnpm gen:client` locally. |
| `deploy/cloudflare-cloud` | The hosted Quai Cloud: a Worker on `cloud.quai.stream` sends every request to one Cloudflare Container running the `cloud` target of the `Dockerfile` (EU only, `lite`). Host-specific code lives here, never in `apps/`. The `cloud` workflow deploys it at each release, with the APNs key from the repository's secrets. |
| `deploy/cloudflare-demo` | The demo home for App Review: a Worker on `demo.quai.stream` in front of one Cloudflare Container running the preview server (`apps/cloud/test/preview.ts`: Quai Cloud and a fake Quai Home on the fixtures), no APNs key. Pair with the server `https://demo.quai.stream` and the code `QUAIDEMO`. The `demo` workflow deploys it when `main` changes what it runs. |
| `Dockerfile` | The two server deliverables, one build: `--target home` and `--target cloud` (default). |

## Host-agnostic

- Quai ships **two generic Docker images**, `quai-home` and `quai` (the Cloud). No code, type or route may assume Umbrel or any other host.
- Quai Cloud stores nothing about a home: no database, nothing on disk. A home's data lives in Quai Home, behind the home store.
- The services' keys never reach the Cloud, not even through a page it serves: they are set in Quai Home's console (`ServiceSettings`) or its environment ([ADR 1](docs/adr/0001-console-served-by-quai-home.md)).
- The contract (`packages/api`) only talks about Quai: *arr services, activities, devices. Never the host.
- All configuration comes from `QUAI_*` environment variables and the `/data` volume.
- Our own hosting of Quai Cloud lives in `deploy/` (Cloudflare), outside the generic images.
- The Umbrel packaging lives in `mathieuletyrant/umbrel-community-app-store` (`mathieu-quai`), not here.

## Language

Everything in the repo is in English: code, comments, UI strings, docs, commit messages.

## Code

- **The glossary's words, everywhere**: code, types, wire values, UI text, docs, commits. A concept it doesn't name yet, or a word that could mean two of its terms: ask the user which word, then add it to `GLOSSARY.md` before using it.
- **Reuse before writing.** Look for the module that already owns the concept (a `Read`, an integration, a `ui/` component, a helper in `integrations/arr.ts`) and extend it. Each rule lives in one module, behind a small interface, with its test there; callers stay short and read top to bottom. A second copy of a rule, or a helper that only passes through, means the code belongs in the existing module.
- **Split by decision.** A function too complex for the lint (`sonarjs/cognitive-complexity` 15, depth 3, 4 parameters) is cut along the decisions it makes: each extracted function is one decision, named in the glossary's words and testable alone (`stepChange`, `whyUnread`). A table keyed by type replaces a long chain of cases. When no cut reads well, the module itself is cut wrong: move the code to the module that owns it.
- Names say what a value is, in loops and callbacks too: `movie`, `candidate`, `index`, `entry`. One letter is never a name.
- Comments carry what the code can't: why, a service's quirk, a gotcha. A doc comment on an export says what it is in a line; the names tell the rest.

## Effect

- `effect` and `@effect/*` are pinned to **4.1.4** through the `catalog:` in `pnpm-workspace.yaml`. Never bump them unasked: `effect/http`, `effect/http-api` and `effect/sql` are marked unstable.
- Reference docs: https://effect.website/llms.txt (v4). When unsure of a signature, read the `.d.ts` files in `node_modules/effect/dist/`.
- One service = one `Context.Service` + one `Layer` (`static readonly layer`). The Cloud never calls a service itself: its calls go through `HomeReads` (offline is 503, a service that didn't answer is unavailable), its watches through `HomeLink`.
- Each service's events (webhook or polling) and actions live in one integration module, `packages/domain/src/integrations/<service>.ts` (see [`docs/flows.md`](docs/flows.md#integrations)).
- Errors: `Data.TaggedError` (or `Schema.TaggedError` when they cross the API). No `throw`.
- No bare `Promise` or `async` on the server: everything is an `Effect`. `Promise` is only allowed at the console's React boundary.
- Time goes through `Clock` (never `Date.now()` in logic) so `TestClock` works. One exception: the start time in `ServerInfo.layer`.
- In `HttpApiBuilder.group`, get services in the outer `Effect.gen`, not inside each handler.

## Per app

Each app's own rules sit next to its code, read when working there: [`packages/domain/AGENTS.md`](packages/domain/AGENTS.md)
(reads, adapters, ids), [`apps/cloud/AGENTS.md`](apps/cloud/AGENTS.md) (one Cloud for many homes), [`apps/console/AGENTS.md`](apps/console/AGENTS.md) (pages, `ui/`,
states, theme tokens), [`apps/ios/AGENTS.md`](apps/ios/AGENTS.md) (errors, the loop without a Mac).

## Tests

- **Test relentlessly.** Every change comes with its tests: a feature, a fix (a test that goes red on the bug first), each branch of a rule, and its edges (empty, missing, offline, a date already past, a service that didn't answer). A change is done when every behaviour it adds or touches has a test.
- `@effect/vitest` (`it.effect`); move time with `TestClock.adjust`, never real waits.
- Routes: `HttpApiTest.groups(QuaiApi, [...])` with `NodeHttpServer.layerTest`.
- Quai Home in Cloud tests: `makeFakeHome` with `recordedHome(routes, overrides)` (`"radarr GET /api/v3/queue"` → fixture). It enforces the real allowlist and fails the test on a refused call or watch.
- *arr adapters: recorded real responses (fixtures), never calls to the real stack.
- Responses recorded from a real home live in `apps/cloud/test/fixtures/real` (its README says how they were changed) and `test/real.test.ts` runs the adapters on them: identity across services (TMDB, TVDB, IMDb ids, download hashes) is tested there first.
- Scale: `apps/cloud/test/scale.test.ts` checks the pure computations behind Upcoming, To fix and the Library stay linear on the real home copied over (`test/bigHome.ts`); `pnpm bench` gives the numbers (`test/bench`). A lookup inside a loop goes through a Map or Set built once.
- Contract: a test checks `openapi.json`. After changing `packages/api`, run `pnpm gen:openapi` and commit the file.

## Commits and releases

[Conventional Commits](https://www.conventionalcommits.org): `feat:` → minor, `fix:` → patch, `chore:`/`docs:`/`refactor:` → no release. release-please turns `main` into a release PR; merging it tags, releases and publishes `ghcr.io/mathieuletyrant/quai`.

**Open the PR yourself**, unasked, once a task's code is committed and pushed with `pnpm check && pnpm test` green: a
draft while a check only the CI runs is pending (the `ios` job's build and screenshots). This standing request covers
every task in this repo.

**A PR you open is yours until it merges.** Right after opening it, subscribe to its activity (in Claude Code on the
web, `subscribe_pr_activity`) and see it through: fix a failing CI job, and answer every AI review finding, fixed in a
commit or, when it is wrong, a reply saying why (the review's tuning reads the replies). Then resolve its thread: `main`
merges nothing with an open conversation. A finding left for the user to decide (a security one, a design choice)
stays open, and the user hears why. Unsubscribe once it is merged or closed.

## Commands

```sh
pnpm install
pnpm check        # tsc in every package, then ESLint (lint and dprint format)
pnpm format       # ESLint --fix: writes the format, fixes what it can
pnpm test         # vitest in every package
pnpm gen:openapi  # regenerate packages/api/openapi.json
pnpm gen:client   # the iOS client in apps/ios/Quai/Generated (not committed), needs Swift
pnpm dev:cloud    # Quai Cloud on :8787
pnpm dev:home     # Quai Home on :8788 (QUAI_CLOUD_URL=ws://localhost:8787/home QUAI_HOME_PASSWORD=…)
pnpm dev:console  # console on :5173 (proxies /api, /console-api and /home-api to Quai Home on :8788)
```

iOS (macOS): `pnpm gen:client && cd apps/ios && xcodegen generate && open Quai.xcodeproj`.

## Before finishing a task

`pnpm check && pnpm test` pass. The format is dprint's (through ESLint): `pnpm format` writes it, and in Claude Code the
`.claude/hooks/lint-file.sh` hook runs it on each edited file and sends back what it can't fix; before a turn ends,
`.claude/hooks/check-before-stop.sh` runs `pnpm check && pnpm test` when the code changed and sends a failure back. If `packages/api` changed, `openapi.json` is regenerated and committed.

`apps/site/public/llms.txt` is the full guide to Quai (what it does, the setups, every variable, troubleshooting). Any change to setup, configuration (a `QUAI_*` variable), the images, pairing, the hosted Cloud or what Quai does updates it in the same PR, with the README's settings table. A test fails when a variable Quai Home or Quai Cloud reads is missing from it.
