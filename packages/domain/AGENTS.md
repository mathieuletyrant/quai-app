# The domain

Rules for agents working in `packages/domain`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- One home at a time: these services are built for one home, on its link (`HomeServices`/`HomeApp` in `App.ts`), so a service holds one home's state and never looks another up. What isn't a home's (`Apns`, `PublicAccess`, `ServerInfo`) is only an interface here: the image that runs the domain provides it. A new per-home service goes in `HomeServices`.
- Nothing of an image: no HTTP server, no WebSocket, no APNs key, no `QUAI_CLOUD_*` variable. They stay in `apps/cloud` (and `apps/home`).
- Quai Home runs it, on its home answered in place ([ADR 3](../../docs/adr/0003-quai-home-runs-quai.md)); the tests and the demo run it on a fake home. Nothing here may assume which: a home link may be offline, a call may fail or time out.
- A call to a service is whatever the domain's code sends: no list outside it limits what it may call. A write that replaces a whole document of a service (Cleanuparr's settings) reads it, changes one field and sends the rest back as it came, one at a time.
- Its tests are still in `apps/cloud/test`, where the domain runs on a fake Quai Home in memory (`fakeHome.ts`); `apps/home/test/domain.test.ts` runs it in Quai Home end to end.
- A read is defined once, as a `Read<A>` (service, path, schema): `HomeReads` reads it when the app asks, `watchOf` makes its watch, `readSnapshot` decodes its snapshots (`dayReads`, `pendingRead`). Never a second path or decode for the same GET.
- One adapter per media kind, not branches on the service: movies (Radarr) and series (Sonarr) each implement `MediaFixes` (`fixes/movies.ts`, `fixes/series.ts`); `Fixes.ts` only orchestrates. A new kind or rule goes in its adapter, a target carries only its own kind's fields, and what can be decided without a call is a pure function with its own test.
- An id the server mints and reads back is made and parsed in one module (`fixes/FixId.ts`), never by string prefixes elsewhere.
- One decision per action: the HTTP route and the Live Activity button call the same service function (`Seerr.decide`), which checks the state it acts on; each caller only maps its errors and refreshes the Hub.
- Shared *arr helpers (images, dates, years, queue, releases, manual import) live in `integrations/arr.ts`, not in one service's module.
