# Quai Cloud

Rules for agents working in `apps/cloud`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- What Quai does for a home is the domain's (`packages/domain`, read its [`AGENTS.md`](../../packages/domain/AGENTS.md)): nothing about a service, a flow or a page is written here.
- A Quai Home gets a relay and its pushes, nothing else: `Homes` sends the app's requests to it (`relayed`), `HomeLinks` sends its `PushRequest`s to APNs and remembers its open pairing codes. Nothing is read of what passes but the home id and the path. A Quai Home older than `HomeProtocol.minProtocolVersion` (13, the first that runs Quai) is refused at the handshake.
- One Cloud, many homes: a request goes to its home by its token's home id or its pairing code (`Homes`). What every home shares (`HomeLinks`, `ApnsLive`, `PublicAccessLive`, `ServerInfo`) is built once in `main.ts`.
- The domain's tests still live in `test/` (on a fake Quai Home in memory, `fakeHome.ts`), and so does the preview server the demo runs (`test/preview.ts`): the Cloud's own code never imports the domain's services.
- This app holds what only the Cloud has: the WebSocket Quai Homes link to, the APNs key and client, its public address.
