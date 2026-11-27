# Quai Cloud

Rules for agents working in `apps/cloud`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- What Quai does for a home is the domain's (`packages/domain`, read its [`AGENTS.md`](../../packages/domain/AGENTS.md)): nothing about a service, a flow or a page is written here.
- A Quai Home that runs Quai (protocol 13 and up) gets a relay and its pushes, nothing else: `Homes` sends the app's requests to it (`relayed`), `HomeLinks` sends its `PushRequest`s to APNs and remembers its open pairing codes. Nothing is read of what passes but the home id and the path.
- One Cloud, many homes: for a Quai Home from before, `Homes` builds the domain's `HomeApp` once per home, on that home's link (`HomeLinks`). What every home shares (`HomeLinks`, `ApnsLive`, `PublicAccessLive`, `ServerInfo`) is built once in `main.ts`.
- This app holds what only the Cloud has: the WebSocket Quai Homes link to, the APNs key and client, its public address.
