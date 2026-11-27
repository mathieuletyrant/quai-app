# 3. Quai Home runs Quai; Quai Cloud is the public address and the push sender

Nov 27, 2026 · Accepted

## Context

[Spec v2](../spec-v2-hosted.md) made Quai Home "dumb on purpose": an allowlisted proxy, with
everything else in Quai Cloud (integrations, flows, the engine, the app's pages, the console's
routes), so that a fix ships from the Cloud alone and Quai Home almost never updates.

A week of the hosted Cloud (one Cloudflare Container, `lite`: 1/16 vCPU, 256 MiB) shows what that
costs:

- **The app is slow.** Over 24 h on `cloud.quai.stream`, with one home: Upcoming p50 2.8 s and
  p95 9.5 s, To fix 2.8 s / 12.5 s, the library 2.9 s / 7.7 s, and `/api/health`, which computes
  nothing, p95 5.4 s. The container goes past its CPU quota whenever the app is used.
- **The work is small, and in the wrong place.** The Home tab costs about 20 ms of CPU on a
  laptop, nothing a home server would notice. On the Cloud it is paid on the smallest instance
  there is, for every home, in a product that is free. A bigger instance is about $20 a month with
  no user.
- **The lists cross the network to be thrown away.** One load of the Home tab had Quai Home fetch
  29 lists from the services (45 calls before
  [#170](https://github.com/mathieuletyrant/quai-app/pull/170)) and send them whole over the
  WebSocket, for the Cloud to parse and keep a few fields of.
- **The Cloud sees more than it needs.** Every title, queue and request of a home passes through
  it in clear, to be computed there.

What the Cloud was meant to save didn't happen either: `quai` and `quai-home` are released
together at every version (the console ships with Quai Home since [ADR 1](0001-console-served-by-quai-home.md)),
and the allowlist is at protocol 12 already: a new read is a Quai Home update anyway.

Two things only a hosted Cloud can give, and they are why it exists:

- **an address the iPhone reaches from anywhere**, with no port, tunnel or VPN at home;
- **pushes to the App Store app**, which Apple only takes signed with Quai's APNs key.

## Decision

**Quai Home runs Quai. Quai Cloud is the home's public address and its push sender, nothing more.**

- **Quai Home** runs everything about its home: the integrations, the Hub and the flows, the
  engine, the alerts, the journal, the app's pages (Home tab, To fix, Upcoming, Library, Requests,
  Storage), the console's routes. It calls the services itself, on the LAN, and reads its own
  documents from `/data`. It checks the iPhones' tokens itself.
- **Quai Cloud** does two things:
  1. it **relays** the app's requests to the home the token names, over the WebSocket Quai Home
     already holds, and sends the answer back as it came: the same relay as the console's
     (`ConsoleRequest` → `ConsoleResponse`), the other way round;
  2. it **pushes** what Quai Home asks it to push: Quai Home builds each Live Activity update and
     notification and names the iPhone's token, the Cloud signs it with the APNs key and tells
     Quai Home what APNs answered (a token gone for good).
- **The Cloud computes nothing and reads nothing** of a home: no integration, no flow, no page.
  It still keeps nothing. It is small enough for the smallest instance, whatever the number of
  homes, and could later be a Worker with a Durable Object per home if APNs' HTTP/2 allows it.
- **The same code, moved, not rewritten.** A home's services are already built for one home on
  top of its link (`HomeServices` in `apps/cloud/src/App.ts`). They move to one package both
  images use, the **domain** (`@quai/domain`); in Quai Home the link's calls, watches and
  documents are answered in place instead of over the WebSocket.
- **The app's requests are signed by the iPhone.** At pairing the iPhone makes a **device key**;
  the private key never leaves it, Quai Home keeps the public one. Each request carries its time
  and a signature, and Quai Home answers only what one of its iPhones signed, once, within a
  short window. The Cloud carries the requests and can neither make one nor play one again: it
  only exposes the home. The device token stays, to name the home and the iPhone.
- **The Cloud guards its APNs key.** It pushes only to the Quai app's topic, only for homes that
  proved their home key, within `QUAI_MAX_HOMES`, and within a limit of pushes per home.
- **No home is left behind.** `Hello` says what a Quai Home runs. For a Quai Home from before this
  ADR the Cloud keeps computing as today, until that code is removed at a major version.

## Consequences

- The app is as fast as the home server and the phone's connection allow: the Cloud adds one hop,
  no work. Quai Cloud's cost no longer grows with what the homes hold.
- **A fix in a page or a flow now needs a Quai Home update.** This gives up spec v2's first goal.
  It was already how releases went; the Umbrel store PR per release stays the price.
- **The app and each Quai Home must agree on the contract** at every version of each: the "two
  moving versions" spec v2 wanted gone. The contract (`packages/api`) stays additive, and the app
  already says when a Quai Home is outdated (`homeOutdated`).
- The allowlist, the watches sent by the Cloud and the documents handed over the link disappear
  with the old path: the Cloud no longer asks a home for anything. A compromised Cloud can drop
  or delay requests and read the answers in transit; it can't act on a home. Encrypting the
  requests and answers end to end is possible later and not part of this ADR (the pushes would
  stay readable: Apple and the widget must read them).
- **The iPhones pair again** when their Quai Home moves to the signed requests: an iPhone paired
  before has no device key.
- **Privacy gets better, not perfect.** The Cloud no longer reads the services' lists; it carries
  the app's pages and the pushes' content, in transit only. The privacy page and
  `apps/site/public/llms.txt` say so when the move is done.
- **Quai Cloud becomes what spec v2 called a push gateway**, and the hosted Cloud's value is then
  its address and Quai's key. It stays limited to the homes it accepts (`QUAI_MAX_HOMES`, the home
  key's proof); rate limits per home on pushes come with the move.
- Quai Home uses more of the home server (a Node process that polls and computes): what v1 did.
- With everything at home, the app could talk to Quai Home directly on the LAN when the Cloud is
  down. Not designed here.

## Plan

One pull request each, the app working after every one:

1. **The home's services in a shared package**, the Cloud using it as today. No behaviour changes.
2. **Quai Home runs them** behind a link answered in place, next to the old path; the relay of the
   app's requests and the push request, on a new protocol version; the device key at pairing and
   the signed requests in the app; the Cloud relays to a Quai Home that runs Quai and computes for
   the others.
3. **The pages, then the flows and pushes, move over**, each checked on a real home before the next.
4. **One route for the Home tab**, computed by Quai Home.
5. **The spec, the glossary, the privacy page and `llms.txt`** follow; the Cloud's old path goes at
   the next major version.

## Decided with it

- The names: the **domain** (`@quai/domain`), the **app relay** (`AppRequest`, `AppResponse`), the
  **push request** (`PushRequest`, `PushResponse`), the **device key** (GLOSSARY).
- The Cloud finds a request's home from the home id its device token starts with, as today, and
  checks nothing else: no list of iPhones in the Cloud.
- Signed requests, not end-to-end encryption, for now.

## Amended

Nov 27, 2026, with step 2:

- **A Quai Home moves over all at once, not page by page.** Two servers computing for the same
  home, on the same documents, would be harder to get right than the move itself. A Quai Home at
  protocol 13 runs the whole domain; the Cloud relays to it and pushes for it, and asks it for
  nothing. An older one is served as before. Steps 2 and 3 of the plan are one step.
- **The documents don't move.** They were already Quai Home's: a home updated to protocol 13
  finds its iPhones, flows and activities where the Cloud left them, and nothing is paired again
  for that.
- **A pairing finds its home by its code's hash.** A pairing request carries a code and no token:
  Quai Home tells the Cloud the SHA-256 of each open code (`PairingCodes`), and the Cloud keeps
  them in memory while that home is linked.
- **The Cloud tells a home what only it knows**, in its Welcome: whether it has an APNs key (what
  the console's Settings shows, never the key) and its public address and access headers, for the
  pairing QR code.
- **`QUAI_TZ` is read where Quai runs**: by Quai Home now, by the Cloud for an older one.
- **A Cloud older than its Quai Home refuses it** (its protocol is unknown to it): update the
  Cloud first. The hosted one follows each release.
- **Signed requests come next**, in their own pull request, with the app: until then a request is
  what it was, the iPhone's token alone.
