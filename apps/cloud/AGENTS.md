# Quai Cloud

Rules for agents working in `apps/cloud`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- What Quai does for a home is the domain's (`packages/domain`, read its [`AGENTS.md`](../../packages/domain/AGENTS.md)): nothing about a service, a flow or a page is written here.
- One Cloud, many homes: `Homes` builds the domain's `HomeApp` once per home, on that home's link (`HomeLinks`). What every home shares (`HomeLinks`, `ApnsLive`, `PublicAccessLive`, `ServerInfo`) is built once in `main.ts`.
- This app holds what only the Cloud has: the WebSocket Quai Homes link to, the APNs key and client, its public address.
