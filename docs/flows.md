# Flows

A **flow** describes one kind of Live Activity: what starts it, the steps it goes through, what
each step shows, and when it ends. The server runs flows; the iPhone only draws what the server
describes, so a new flow never needs an app update.

The four Live Activities of the v1 spec become built-in flows (Download, Jellyfin playback,
Server incident; Today's releases comes next), plus Requests (Seerr requests to approve).
Built-in flows can be edited and duplicated in the console; custom flows are made from the same pieces.

## Model

```
Flow
  id            slug, unique ("download", "anime-downloads")
  name          "Download"
  builtIn       true for the presets (can't be deleted, can be edited and reset)
  enabled       off: no activity starts for anyone
  color         hex, the activity's tint ("#FFC230")
  icon          SF Symbol name, the flow's glyph ("arrow.down")
  subject       what one activity follows: media | playback | service | request
  filter        media, request: movies, series or both · playback: Jellyfin device names (empty: all)
  steps         1 to 6, in order (below)
  endOn         optional: an event that ends the activity where it is, without being a step
                (playback stopped, request declined). Reaching the last step ends the activity
                too, except in a one-step flow with endOn: it runs until that event.
  lingerMinutes how long the end stays on screen (0 to 60)
  stalledAfterMinutes   a step showing progress with no progress for this long turns grey (optional)
  expireAfterMinutes    no event at all for this long ends the activity (optional)

Step
  id      slug, unique in the flow
  label   "Downloading"
  icon    SF Symbol name
  on      the catalog event that enters this step
  show    which live values the step displays: progress, speed, eta, timer (to an end time,
          with a timeline the iPhone animates itself), since (time elapsed since the step began)
  actions buttons the step offers on the Live Activity (below)
```

A one-step flow needs `endOn` or `expireAfterMinutes`, or it would never end.

## Event catalog

Events are normalized by the adapters; flows only see these. Each belongs to a subject.

| Event | Subject | From | Carries |
| --- | --- | --- | --- |
| `media.added` | media | Radarr MovieAdded | title, media type |
| `media.grabbed` | media | Radarr / Sonarr Grab | title, torrent id |
| `media.imported` | media | Radarr / Sonarr Download | title |
| `media.available` | media | Jellyfin (polled after an import) | title |
| `download.progress` | media (by torrent id) | qBittorrent (polled) | progress, speed, eta |
| `playback.started` | playback | Jellyfin sessions (polled) | title, device, end time |
| `playback.progress` | playback | Jellyfin sessions (polled) | end time, paused |
| `playback.stopped` | playback | Jellyfin sessions (polled) | |
| `service.down` | service | health checks (polled) | service name, since |
| `service.up` | service | health checks (polled) | |
| `request.pending` | request | Seerr `MEDIA_PENDING` (webhook), pending requests (polled) | title, requester, kind, year |
| `request.approved` | request | Seerr `MEDIA_APPROVED` (webhook), or gone from the pending list approved | |
| `request.declined` | request | Seerr `MEDIA_DECLINED` (webhook), or gone from the pending list declined or deleted | "Declined" |

Events marked *progress* are **data events**: they update the current step's values and never
change the step. All others are **step events**.

## Actions

Buttons on the Live Activity, from a catalog like events. A tap runs an App Intent in the app
(iOS wakes it in the background), which calls `POST /api/activities/actions`; the server checks
the activity's current step offers the button, sends it to the service, and refreshes at once.

| Action | Subject | Does |
| --- | --- | --- |
| `playback.playPause` | playback | Jellyfin remote: play or pause the session |
| `playback.stop` | playback | Jellyfin remote: stop the session |
| `request.approve` | request | Seerr: approve the request (`POST /api/v1/request/{id}/approve`) |
| `request.decline` | request | Seerr: decline the request (`POST /api/v1/request/{id}/decline`) |

Next in the catalog: "Other release" and "Retry" for downloads (spec v1, Live Activities).

## Integrations

In Quai Cloud, each service is one module in `apps/cloud/src/integrations/`: everything Quai
knows about it sits together, so its events and actions are readable at a glance. The Cloud never
reaches a service itself: Quai Home forwards the webhooks, polls the watches and runs the calls.

| Integration | Webhook (forwarded by Quai Home) | Watch (polled by Quai Home, only when a flow needs it) | Actions (calls through Quai Home) |
| --- | --- | --- | --- |
| `radarr` | `media.added`, `download.grabbed`, `download.imported` | — | — |
| `sonarr` | same, for episodes | — | — |
| `qbittorrent` | — | download progress, every 5 s, while a download runs | — |
| `jellyfin` | — | `media.available`, every 15 s, while an activity awaits it; `playback.*`, every 15 s, while a playback flow is on | `playback.playPause`, `playback.stop` |
| `quai` (health) | — | `service.down` / `service.up`, every minute, while a service flow is on | — |
| `reclaimerr` | — | — | — (only feeds the To fix list) |
| `seerr` | `request.*` (when Quai Home could set the webhook up) | pending requests, every 60 s, while a request flow is on | `request.approve`, `request.decline` |

### Seerr requests

The Requests flow follows a request that **waits for approval**: Seerr's `MEDIA_PENDING`, or status
pending (1) in the poll. A request Seerr approved on its own (an auto-approve user, `MEDIA_AUTO_APPROVED`)
never waits: it starts nothing, isn't listed and pushes nothing. Approved, it reaches its last step
and ends; Radarr or Sonarr then add the title and the Download flow takes over, as for any title.
Declined (or deleted in Seerr), it ends where it is, saying so. No news for a day: it ends.

Seerr has a single webhook agent (one URL). At start, Quai Home takes it only when it is off or has
no URL, or already points to Quai Home's own receiver (then it updates it), with Quai's JSON
template (type, title, request id, media type and TMDB id, requester) and the pending, approved
and declined types. Another webhook is left untouched (logged). Either way, the Cloud polls the
pending requests every minute while a request flow is on: the way in without the webhook, and the
safety net for a notification missed while Quai Home was down. A request that leaves the pending
list is read once (`GET /api/v1/request/{id}`) to tell approved from declined. The webhook settings
are Quai Home's own write, like the Radarr and Sonarr webhooks: they are not in the Cloud's
allowlist.

The app's Home tab shows a Requests tile (count, first posters) opening a Requests screen with
Approve and Decline (Decline asks first); the console has a Requests page. Both read
`GET /api/requests` (`/console-api/requests`) when shown: titles and posters come from Seerr's
`/api/v1/movie/{tmdbId}` and `/api/v1/tv/{tmdbId}`, kept in memory only.

### The To fix list

Not a flow: fixed rules the Cloud runs when the app or the console asks (`GET /api/fixes`,
`/console-api/fixes`), on what Quai Home reads then. Nothing is kept; what the user hid lives in
home documents (`fixes/snoozed/<id>`, `fixes/dismissed/<id>`), cleared once the problem is gone.
The reads and the rules sit in each service's integration module (`radarr.ts`, `sonarr.ts`,
`arr.ts`, `reclaimerr.ts`); `fixes/Fixes.ts` runs them and the fixes.

| Problem | Rule | Fixes |
| --- | --- | --- |
| Import blocked | A queue item at `importBlocked`, or `importPending` with a warning | Remove (`DELETE /api/v3/queue/{id}`, optionally blocklisted, never searched again); Import anyway (`ManualImport` of the files as matched, or to the episode chosen, never over a file) |
| No source | Monitored, available (aired), no file, nothing in the queue, no grab since, for 2 hours (since it was added or came out; grabs read 30 days back) | Search releases (interactive search; for a season, only releases covering nothing but missing episodes) and Grab; Ignore and wait (until a release is grabbed, or some days) |
| Scheduled deletion | A Reclaimerr candidate `scheduled`, `eligible` or `postponed`, not protected | Keep (Reclaimerr's `protect`); Let it go (hidden in Quai) |

An integration is a plain value (`Integration` in `Integration.ts`): an optional `webhook` that
reads payloads into catalog events, an optional `watcher` (`watches(context)`: the allowlisted
GETs it needs polled now; `read(snapshot, context)`: what a snapshot means; `failed` and `tick`
for health), and `actions` keyed by action type. The `Hub` runs it all: it sends Quai Home the
watch list whenever what the flows and running activities need changes (and on each connection),
hands each snapshot or webhook to its integration and the events to the engine, runs a 15-second
heartbeat for the engine's housekeeping, and after a button press sends the watches again so Quai
Home reads them at once. Adding a service: write its integration, list it in `All.ts`, add its events and
actions to the catalog in `packages/api`.

## Engine rules

1. One activity per flow and subject (`flowId|subjectKey`). Several flows can follow the same
   subject (a "Download" and an "Anime downloads" flow filtered to series).
2. A step event for a subject with no activity starts one **at that step**, whichever it is: a
   missed webhook doesn't lose the title.
3. A step event moves the activity forward to its step, never backwards.
4. Reaching the last step ends the activity, and so does `endOn`, where the activity is (with
   what the event says, "Declined"). A one-step flow with `endOn` (playback) runs until that event
   or expiry. The end stays on screen `lingerMinutes`, then is forgotten.
5. Data events update the current step's values; pushes for them go out at most every 5 s per
   activity. Step changes, a pause or a resume, and a stalled download moving again go at once.
   Times are compared to 10 s: a playback's end drifting by milliseconds between polls is not news,
   since the iPhone animates the timeline itself.
6. `stalledAfterMinutes` without progress turns the activity grey; progress turns it back.
7. `expireAfterMinutes` without any event ends the activity where it is.
8. The engine is pure and its state is saved after every change, so a restart loses nothing.

## What the iPhone receives

One ActivityKit type, `QuaiActivityAttributes`, for every flow:

```
attributes  key, flowId, title, color, icon, steps [{ id, label, icon }]
content     step (index into attributes.steps), tone (active | stalled | done),
            progress, bytesPerSecond, remainingSeconds, endsAt, startsAt, paused, since, detail —
            each only when the step shows it
```

`attributes.steps[].actions` lists the buttons of each step. With `startsAt` and `endsAt` the
iPhone draws the timeline on its own (no push per second); `paused` holds it at `progress`.

```
```

## Per iPhone

Each iPhone chooses, per flow: on or off, and which steps it shows (the last step always shows:
it ends the activity). The server filters per iPhone: an iPhone that hides a step gets no push
for it, its activity starts at its first shown step, and `attributes.steps` lists only its steps.

## Swiped away

An iPhone's user can swipe a Live Activity away. The app tells the server which activities are
still on screen (when it opens, and at once if it's running), and the server forgets the others,
noting where they were. Such an activity stays away while nothing changes, and starts again as a
new one at its next step, pause or resume. An activity swiped away while the app isn't running is
only known once the app opens.

## Limits

- 2 to 6 steps: more doesn't fit on the Lock Screen.
- At most one data update every 5 s per activity (12 a minute at most), so iOS doesn't throttle
  Quai; what is held back goes out with the next heartbeat (every 5 s). Step changes, a pause, a
  resume or a download moving again go at once. Nothing is pushed when nothing visible changed.
- qBittorrent is read every 5 s (the Home protocol's minimum) while a step shows progress.
- Polling only runs for what an enabled flow needs: qBittorrent while a step shows progress,
  Jellyfin availability while an import awaits it, Jellyfin sessions while a playback flow is on,
  health checks while a service flow is on, Seerr's pending requests (every 60 s) while a request
  flow is on.

## Console

Flows page: list with on/off, edit (name, color, icon, filter, steps picked from the catalog for
the flow's subject, what each step shows, linger, stall and expiry), duplicate, delete (custom
flows), reset (built-in flows), and test (plays the flow's steps on the paired iPhones you pick). Each iPhone's own choices (which flows it shows, which steps) are in the app, under Settings → On this iPhone.

## What people can build

A check that the editor stays at the right level: pieces to stack, no rule language. What makes
it richer is the catalog (events, actions) and the filters, not the editor.

| Flow | Today |
| --- | --- |
| Anime: series only, without the Searching step | ✅ |
| Living room night: playback on the TV only, with Play/Pause and Stop | ✅ |
| Express downloads: Downloading → Ready only | ✅ |
| Server incident limited to Radarr and Sonarr | ❌ needs a service filter |
| French subtitles: Imported → Subtitles found → Ready | ❌ needs a Bazarr event |
| Requests to approve, with Approve and Decline | ✅ |
| 4K movies, Julie's requests | ❌ needs quality profile and requester filters (Seerr) |
| Tonight: today's episodes at 18:00 | ❌ needs a time trigger and the Sonarr calendar |
| Disk almost full | ❌ needs a disk event |
