# Home settings from the console

Status: proposal, not built.

Today every service Quai Home reaches is configured by environment variables. On Umbrel that is
the app's settings form in umbrelOS. This page moves the services' configuration into a
**Services** page of the console, with one rule: **the services' keys never go through Quai Cloud**
(spec v2: "the *arr keys never leave home").

## What we saw on Nov 21, 2026

- The umbrelOS form holds 13 settings, mostly keys, with no way to test one before saving and
  no feedback when a key is wrong. Quai Home only says so in its logs.
- A new setting (`QUAI_RADARR_PUBLIC_URL`) needs a store release before it can be filled in.
  Mathieu added it by hand as a custom variable meanwhile, so the same value now sits in two
  places.
- Quai Home and Quai Cloud ship as two images. Renovate bumped one and not the other, and the new
  setting was silently ignored by the old Home.
- Seen from the console, nothing tells whether Radarr's key is right: only the Journal, after the
  fact.

## What is configured where

| Setting | Read by | Today | Proposed |
| --- | --- | --- | --- |
| `QUAI_CLOUD_URL`, `QUAI_HOME_PORT`, `QUAI_DATA_DIR`, `QUAI_INTERNAL_URL` | Home | env | env: where Home runs, set by the packaging |
| `QUAI_<SERVICE>_URL` (Radarr, Sonarr, Jellyfin, Seerr, Prowlarr, Reclaimerr, Cleanuparr, qBittorrent) | Home | env (compose defaults on Umbrel) | env as a default, overridable in the Services page |
| `QUAI_<SERVICE>_API_KEY`, `QUAI_QBITTORRENT_USERNAME` / `_PASSWORD` | Home | env (umbrelOS form) | **Services page** |
| `QUAI_RADARR_WEB_URL`, `QUAI_SONARR_WEB_URL`, `*_PUBLIC_URL` | Home | env | **Services page** (env default for the home one) |
| `QUAI_APNS_*`, `QUAI_PUBLIC_URL`, `QUAI_PUBLIC_HEADERS`, `QUAI_HOME_ID`, `QUAI_TZ`, `QUAI_PORT` | Cloud | env | env: the Cloud's own deployment, out of scope |

Only Home's settings move. The Cloud's stay env: on a hosted Cloud they are the operator's, not
the home's.

## Design

### One console, Home answers its own path

- The Services page lives in the console like every other page: one UI codebase, one look.
- It calls `/home-api/*` (`GET /home-api/services`, `PUT /home-api/services/:service`,
  `POST /home-api/services/:service/test`). **Quai Home answers that path itself.**
- Where Home stands in front of the Cloud, Home serves `/home-api/*` and relays every other request
  to the Cloud, unchanged. On Umbrel, `app_proxy` points at Home instead of the Cloud, so the
  Umbrel login guards both.
  - The relay target comes from `QUAI_CLOUD_URL` (`ws://cloud:8787/home` → `http://cloud:8787`).
  - The relay is generic, with no Umbrel in the code. `QUAI_RELAY=off` turns it off, for a Cloud
    hosted elsewhere.
- The browser's request for a key goes to Home and stops there. The Cloud never sees the path,
  the body or the answer.
- Opened straight from a Cloud with no Home in front (a hosted Cloud), the Services page shows
  each service's state (reached, refused, unread, as the Cloud already knows it) and says the
  keys are set from the home's network.

### Storage, and what never leaves Home

- `/data/settings.json`, mode `0600`, written atomically like the documents.
- It is **not** a home document. Every document under `HomeStore` is handed to the Cloud at link
  time (`StoreList`), which keys must never be.
- `GET /home-api/services` returns, per service:
  - the URL, the web and public URLs;
  - for each secret, only whether it is set, and from where (`settings`, `env`, or none);
  - the last test's result.

  A key is never sent back, not even masked to its last characters.
- Changing a service's **URL clears its key** unless the same request sends a key too. Otherwise
  whoever reaches the page could point Radarr's URL at their own host and receive Radarr's key
  with Home's next call.

### Precedence and moving off env

- A value saved in the Services page wins over env, and env is the default. A compose default
  (`http://radarr_server_1:7878`) needs nothing saved.
- **Adoption.** On start, Home copies into `settings.json` every key that env sets and the file
  doesn't have yet, so a later release can drop the env variable without losing the value. The
  page shows where each value came from.
- On Umbrel, in two releases, because a removed manifest setting is no longer injected:
  1. **N**: Home adopts. The manifest keeps its settings, with notes saying they're now edited in
     Quai, and that a change there only applies when nothing is saved in Quai.
  2. **N+1**: the manifest drops the key settings. Left are the qBittorrent picker (an `options:`
     list is still the easiest way to choose an Umbrel app) and the Cloud's own settings (APNs,
     public URL and headers).

### Applying a change without a restart

- Home's config becomes a value it can replace (`SubscriptionRef`) instead of a layer read once.
  `ServiceAuth`, `Calls`, `Watches` and the webhook setup read the current value.
- Saving runs in this order:
  1. test with the new values (below);
  2. write the file;
  3. re-run the webhook setup for that service (Radarr, Sonarr, Seerr);
  4. tell the Cloud.
- Telling the Cloud: Home's `Hello` carries the services and the web URLs, so a change needs the
  Cloud to hear them again. Protocol 7 adds `ServicesChanged { services, webUrls }`. An older
  Cloud gets a reconnect instead, which sends a fresh `Hello`.

### Testing before saving

`POST /home-api/services/:service/test` calls the service's health endpoint, the same one the
Service down alert uses, with the values in the request, not the saved ones. The answer is the
service's words: "Radarr answered 401: the API key is wrong", "unreachable at
http://radarr_server_1:7878". Saving refuses a key the service refuses, unless the request says
`force` (a service down for now).

### Who can open the page

- On Umbrel: the Umbrel login, through `app_proxy`, as for the rest of the console.
- Elsewhere, Home's port is on the LAN with no login of its own. `/home-api/*` then needs a token,
  `QUAI_SETTINGS_TOKEN`, sent as a bearer by the console after you type it once (kept in
  `sessionStorage`).
  - Without the token set, the API answers only to the relay's own origin. When the relay is off,
    it answers nobody, and keys stay env-only.
  - `app_proxy` on Umbrel sends no such token, so Home trusts requests that came through its relay
    from the proxy. The packaging sets `QUAI_SETTINGS_BEHIND_AUTH=true` for that.

## Out of scope

- The Cloud's own settings (APNs key, public address and headers): the Cloud's deployment.
- Editing flows, alerts or iPhones: already in the console, stored as home documents.
- Encrypting keys at rest: `/data` is the home's disk, like the services' own config files.

## Order of work

1. Home: `settings.json`, `/home-api/*`, test, adoption, live config. Tests with recorded service
   answers.
2. Protocol 7 `ServicesChanged`; the Cloud refreshes its services and web URLs.
3. Home's relay to the Cloud, `QUAI_RELAY`, `QUAI_SETTINGS_TOKEN` / `_BEHIND_AUTH`.
4. Console: the Services page (one row per service: state, URL, key set or not, Test, Save).
5. Umbrel (`mathieu-quai`): `app_proxy` → Home, release N (adoption), then N+1 (form trimmed).
