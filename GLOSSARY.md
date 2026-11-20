# Glossary

The words Quai's code, docs and reviews use for its moving parts. One name per thing.

**Quai Home** (`apps/home`). The server that runs at home, next to the services, with their URLs
and keys. It opens one WebSocket to Quai Cloud, runs the calls and watches the Cloud asks for
within the allowlist, forwards webhooks, and keeps the home's documents (paired iPhones, flows,
activities) on its `/data` volume.

**Quai Cloud** (`apps/cloud`). The server the app and the console talk to. It runs the flows,
pushes to APNs and serves the console, from what Quai Home reads and sends. It keeps nothing: no
database, nothing on disk; the home's documents are in memory while the home is linked.

**Home link** (`HomeLink`). The WebSocket between the two, its handshake, and the messages on it
(`packages/api/src/Home.ts`, `HomeProtocol`). Features don't call through it themselves: their
calls go through `HomeReads`, the watches through the Hub.

**Home read** (`HomeReads`). A call the Cloud has Quai Home make to a service when it needs the
answer now: a GET (`read`, `all`) or a write (`write`). One policy for all of them: Quai Home gone
is *offline*; a service that didn't answer as expected is *unavailable* (None, logged with its
service and path, never what it answered), or a refusal in words for a write.

**Watch**. A GET Quai Home polls on its own, every few seconds to an hour, while a flow needs it
(or the journal: Cleanuparr's removals, while Quai Home reaches it), sending a snapshot when the
answer changes. The Hub sets the list; Quai Home stops polling when the link drops.

**Allowlist** (`HomeProtocol.allowlist`, `allowRule`). The method, path and, for some writes, body
checks of everything the Cloud may ask Quai Home to call or watch. Quai Home enforces it: a
compromised Cloud can't read settings (but for Cleanuparr's queue cleaner, which holds no secret)
or delete a library. The Cloud's tests run against a fake
Quai Home that enforces it too (`apps/cloud/test/fakeHome.ts`), so a path it refuses fails them.

**Checked against** (`AllowRule.against`). A write that replaces a whole document of a service
(Cleanuparr's queue cleaner settings): Quai Home reads the document first and sends the write only
if the rule's check of the two passes, so the Cloud changes the one field it may change.

**Offline** (`HomeOffline`, 503). No Quai Home is linked, or it dropped during the request. Nothing
can be read: the whole answer fails, it is never a partial one.

**Unavailable** (`unavailable: [...]`, a 200). Quai Home is linked, reaches the service, but the
service didn't answer as expected this time (timeout, refused call, non-2xx, unreadable body). The
other services still show. A service Quai Home doesn't reach at all is neither: it is skipped.

**Journal** (`Journal`, `packages/api/src/Journal.ts`). What Quai did, one plain line per thing:
a webhook and what it meant, an activity's steps and the iPhones it reached, Apple's refusals, a
service that stopped answering and came back, Quai Home linked or gone, a button pressed and how it
went. Never a token or a key. Quai Cloud keeps the last 200 lines in memory for the console's live
view and hands the rest to Quai Home in batches (`JournalAppend`); Quai Home keeps 7 days, at most
5000 lines, in `/data/journal/` (one JSON line per entry, one file per UTC day), with its own lines
(webhooks in, allowlist refusals, services it can't reach). The console reads pages back with
`JournalRead`.
