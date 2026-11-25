# Console

Rules for agents working in `apps/console`, on top of the root [`AGENTS.md`](../../AGENTS.md).

`apps/console/src` (React 19, Tailwind v4). A page reads as a short list of sections; the look lives in `ui/`.

- **Served by Quai Home** ([ADR 1](../../docs/adr/0001-console-served-by-quai-home.md)). `callHome` reaches Quai Home's own routes (`/home-api`: sign-in, the home, the services); `call` reaches the Cloud's (`/console-api`, `/api/health`), which Quai Home relays over the link. A new Cloud route needs nothing in Quai Home; a Cloud route that must never be relayed stays out of `HomeProtocol.isConsolePath`.
- **The app to live with Quai, the console to set it up.** The console only has setup pages (Settings, Services, Flows, Alerts, iPhones) and the Journal, to see what Quai did. What's used day to day (requests, fixes, today's releases, the library) lives in the iOS app only: no console page, no `/console-api` route for it.
- `ui/` is the single source of the look, one file per job (buttons, layout, feedback, forms, menus, nav, log, status, table, checklist, icons), re-exported by `ui/index.ts`: import `from "../ui"`. A page that needs a new look adds or extends a `ui/` component; delete what nothing imports.
- Loading, offline, failed and ready go through one primitive: read with `useLoad` (`load.ts`), show with `<Async state loading offline failed>{(data) => …}</Async>`, report with `<ErrorCallout unlessOffline>`. Data-specific states (empty, not configured) are early returns in the component that gets the data. No ternary chains for states.
- Rows and items are named components with explicit props (`DeviceName`, `StepNode`).
- Theme tokens only: colours, the type scale (`text-caption`, `text-body`, `text-subhead`…), tracking, radii and shadows are `@theme` tokens in `styles.css`. No arbitrary `[#hex]`, `text-[Npx]` or `rounded-[Npx]`; add a token instead. Arbitrary values are kept for one-off layout calcs (`grid-cols-[minmax(0,1fr)_300px]`, `h-[calc(100vh-4rem)]`). In JS styles use `var(--color-…)`; hex only for data (a flow's colour) or a library that takes hex.
- Text and logic stay out of the markup: subtitles, facts and labels are small named functions next to the page, or in `format.ts` when pages share them (`duration`, `shortMinutes`). No multi-line expressions in props.
