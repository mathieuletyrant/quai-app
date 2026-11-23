# 1. The console is served by Quai Home

Nov 23, 2026 · Accepted

## Context

Quai runs in two parts: Quai Home next to the services, Quai Cloud anywhere (hosted by us, or
self-hosted). Until now the console was served by Quai Cloud, and Quai Home read every service's
address and key from environment variables (`QUAI_RADARR_URL`, `QUAI_RADARR_API_KEY`…).

That left no good place to set the services up:

- a form in a Cloud-served console sends the keys through the Cloud, against the rule that **the
  keys never leave home**. Encrypting them in the browser to the Home's key doesn't help: the page
  that encrypts is JavaScript the Cloud serves, so a compromised Cloud could serve one that leaks
  them, which is the very case the rule is there for;
- a separate page on Quai Home gives the user **two interfaces** for one product;
- environment variables only work for whoever is at ease with Docker, and are the only way today.

The console's pages are setup pages (Settings, Services, Flows, Alerts, iPhones, Journal), used at
home: the day-to-day lives in the iOS app. Their data is the home's documents, which Quai Home
already keeps; their logic (flows, pairing, alerts, the journal's live view, testing a flow) runs
in the Cloud, on its engine and its APNs key.

## Decision

**Quai Home serves the whole console.** One interface, one address (`:8788`), the same whatever
runs the Cloud (ours, the user's, or none yet).

- **`/home-api`** (`HomeConsoleApi`, `packages/api/src/HomeConsole.ts`) is Quai Home's own: the
  sign-in, where the home stands (its Cloud, the link), and the **Services page**: each service's
  address and key, saved in `/data/services.json` (0600), tested on save, applied without a
  restart. A key is write-only: once saved the console shows it as set, never its value. An
  environment variable still wins and is shown read-only.
- **`/console-api`** stays the Cloud's routes. Quai Home **relays** them over the WebSocket it
  already holds (`ConsoleRequest` → `ConsoleResponse`, protocol 7): the Cloud runs them through its
  own router, the same handlers and tests as before. Its public port refuses `/console-api`: the
  console's routes only answer what Quai Home relays.
- **The console asks for a password**, `QUAI_HOME_PASSWORD` (required, or the console stays locked
  and says what to set). A session lasts 30 days in an `HttpOnly` cookie, signed with a secret
  derived from the home key; changing the password signs every browser out.
- **`QUAI_CLOUD_URL`** is set by environment variable only, and optional: without it Quai Home runs
  alone, its console works for the services and says what to set. Quai Home remembers the Cloud it
  last linked to (`/data/cloud.json`); when it changes, the console asks to pair the iPhones again.
- **Two images, no mode**: `quai-home` (Quai Home and the console) and `quai` (Quai Cloud, no
  interface). Self-hosting everything is running both.

## Consequences

- The keys never reach the Cloud, not even encrypted: Quai Home only tells it which services it
  reaches (`Hello`, then `ServicesChanged`).
- The console works without a Cloud, for the services. The pages that need it (iPhones, flows,
  alerts, journal) say "Quai Cloud isn't reachable".
- The console is reachable at home only, or through a tunnel to Quai Home. Fine for setup pages.
- A console change ships with the `quai-home` image, not the Cloud: the Home updates a little more
  often than the spec hoped. Its data and logic still come from the Cloud.
- The relay is generic: a new console route in the Cloud needs no change in Quai Home.
- Pairing: the QR code carries where the iPhone reaches the Cloud at home, `QUAI_CLOUD_APP_URL`
  (else `QUAI_CLOUD_URL` in http(s)), plus the Cloud's `QUAI_PUBLIC_URL`, no longer the address
  the console was opened at. `QUAI_CLOUD_URL` may name the Cloud by a container name only Quai
  Home resolves, hence the second variable.

## Later: a paid hosted Cloud

Not designed yet. Three choices keep it open:

- the Cloud stores nothing: a paid Cloud can check a **license signed by Quai** (home id, expiry),
  sent by Quai Home in `Hello` and verified offline, without a database;
- one `quai` image: the license check would be a variable set on our Cloud only; a self-hosted
  Cloud doesn't set it and stays complete and free;
- `Welcome` is where the Cloud tells Quai Home what it requires, so its console can show a
  "Subscribe" button. Buying through the console (a web page, not the app) keeps App Store
  rules out of it; in-app purchase can be a second source of licenses later.
