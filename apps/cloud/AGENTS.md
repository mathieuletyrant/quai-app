# Quai Cloud

Rules for agents working in `apps/cloud`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- One Cloud, many homes: a home's services are built for it alone (`HomeServices`/`HomeApp` in `App.ts`, one per home by `Homes`), so a service holds one home's state and never looks another up. What every home shares (`HomeLinks`, `Apns`, `PublicAccess`, `ServerInfo`) is built once in `main.ts`. A new per-home service goes in `HomeServices`.
- A read is defined once, as a `Read<A>` (service, path, schema): `HomeReads` reads it when the app asks, `watchOf` makes its watch, `readSnapshot` decodes its snapshots (`dayReads`, `pendingRead`). Never a second path or decode for the same GET.
- One adapter per media kind, not branches on the service: movies (Radarr) and series (Sonarr) each implement `MediaFixes` (`fixes/movies.ts`, `fixes/series.ts`); `Fixes.ts` only orchestrates. A new kind or rule goes in its adapter, a target carries only its own kind's fields, and what can be decided without a call is a pure function with its own test.
- An id the server mints and reads back is made and parsed in one module (`fixes/FixId.ts`), never by string prefixes elsewhere.
- One decision per action: the HTTP route and the Live Activity button call the same service function (`Seerr.decide`), which checks the state it acts on; each caller only maps its errors and refreshes the Hub.
- Shared *arr helpers (images, dates, years, queue, releases, manual import) live in `integrations/arr.ts`, not in one service's module.
