# AGENTS.md

Rules for agents working on Quai. Read the product spec, [`docs/spec-v1.md`](docs/spec-v1.md), before building a feature.

## Layout

| Path | Role |
| --- | --- |
| `packages/api` | The contract: Effect `HttpApi` + `Schema`. Single source of truth for routes and types. Generates `openapi.json`. |
| `apps/server` | Effect server on Node: implements the contract, listens to the stack, pushes to APNs, serves the console. |
| `apps/console` | React + Vite web console, with a typed client derived from `packages/api`. |
| `apps/ios` | SwiftUI app + widget extension (Live Activities). XcodeGen project (`project.yml`), client generated from `openapi.json`. |
| `Dockerfile` | The only server deliverable: one generic image. |

## Host-agnostic

- Quai ships **one generic Docker image**. No code, type or route may assume Umbrel or any other host.
- The contract (`packages/api`) only talks about Quai: *arr services, activities, devices. Never the host.
- All configuration comes from `QUAI_*` environment variables and the `/data` volume.
- The Umbrel packaging lives in `mathieuletyrant/umbrel-community-app-store` (`mathieu-quai`), not here.

## Language

Everything in the repo is in English: code, comments, UI strings, docs, commit messages.

## Effect

- `effect` and `@effect/*` are pinned to **4.1.4** through the `catalog:` in `pnpm-workspace.yaml`. Never bump them unasked: `effect/http`, `effect/http-api` and `effect/sql` are marked unstable.
- Reference docs: https://effect.website/llms.txt (v4). When unsure of a signature, read the `.d.ts` files in `node_modules/effect/dist/`.
- One service = one `Context.Service` + one `Layer` (`static readonly layer`). One `Layer` per *arr service.
- Errors: `Data.TaggedError` (or `Schema.TaggedErrorClass` when they cross the API). No `throw`.
- No bare `Promise` or `async` on the server: everything is an `Effect`. `Promise` is only allowed at the console's React boundary.
- Time goes through `Clock` (never `Date.now()` in logic) so `TestClock` works. One exception: the start time in `ServerInfo.layer`.
- In `HttpApiBuilder.group`, get services in the outer `Effect.gen`, not inside each handler.
- No Kysely: `@effect/sql-kysely` has no v4 release. Use `SqlClient` from `effect/sql`.

## Tests

- **No feature merged without its test.**
- `@effect/vitest` (`it.effect`); move time with `TestClock.adjust`, never real waits.
- Routes: `HttpApiTest.groups(QuaiApi, [...])` with `NodeHttpServer.layerTest`.
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
pnpm dev:server   # server on :8787
pnpm dev:console  # console on :5173 (proxies /api to :8787)
```

iOS (macOS): `cd apps/ios && xcodegen generate && open Quai.xcodeproj`.

## Before finishing a task

`pnpm check && pnpm test` pass. If `packages/api` changed, `openapi.json` is regenerated and committed.
