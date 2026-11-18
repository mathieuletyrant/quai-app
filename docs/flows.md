# Flows

A **flow** describes one kind of Live Activity: what starts it, the steps it goes through, what
each step shows, and when it ends. The server runs flows; the iPhone only draws what the server
describes, so a new flow never needs an app update.

The four Live Activities of the v1 spec become built-in flows (Download, Jellyfin playback,
Server incident; Today's releases comes next). Built-in flows can be edited and duplicated in the
console; custom flows are made from the same pieces.

## Model

```
Flow
  id            slug, unique ("download", "anime-downloads")
  name          "Download"
  builtIn       true for the presets (can't be deleted, can be edited and reset)
  enabled       off: no activity starts for anyone
  color         hex, the activity's tint ("#FFC230")
  icon          SF Symbol name, the flow's glyph ("arrow.down")
  subject       what one activity follows: media | playback | service
  filter        media: movies, series or both · playback: Jellyfin device names (empty: all)
  steps         2 to 6, in order (below)
  lingerMinutes how long the last step stays on screen (0 to 60)
  stalledAfterMinutes   a step showing progress with no progress for this long turns grey (optional)
  expireAfterMinutes    no event at all for this long ends the activity (optional)

Step
  id      slug, unique in the flow
  label   "Downloading"
  icon    SF Symbol name
  on      the catalog event that enters this step
  show    which live values the step displays: progress, speed, eta, timer (to an end time),
          since (time elapsed since the step began)
```

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

Events marked *progress* are **data events**: they update the current step's values and never
change the step. All others are **step events**.

## Engine rules

1. One activity per flow and subject (`flowId|subjectKey`). Several flows can follow the same
   subject (a "Download" and an "Anime downloads" flow filtered to series).
2. A step event for a subject with no activity starts one **at that step**, whichever it is: a
   missed webhook doesn't lose the title.
3. A step event moves the activity forward to its step, never backwards.
4. Reaching the last step ends the activity: it stays on screen `lingerMinutes`, then is forgotten.
5. Data events update the current step's values; pushes for them go out at most every 15 s per
   activity (step changes go at once).
6. `stalledAfterMinutes` without progress turns the activity grey; progress turns it back.
7. `expireAfterMinutes` without any event ends the activity where it is.
8. The engine is pure and its state is saved after every change, so a restart loses nothing.

## What the iPhone receives

One ActivityKit type, `QuaiActivityAttributes`, for every flow:

```
attributes  key, flowId, title, color, icon, steps [{ id, label, icon }]
content     step (index into attributes.steps), tone (active | stalled | done),
            progress, bytesPerSecond, remainingSeconds, endsAt, since, detail — each only when
            the step shows it
```

## Per iPhone

Each iPhone chooses, per flow: on or off, and which steps it shows (the last step always shows:
it ends the activity). The server filters per iPhone: an iPhone that hides a step gets no push
for it, its activity starts at its first shown step, and `attributes.steps` lists only its steps.

## Limits

- 2 to 6 steps: more doesn't fit on the Lock Screen.
- At most one data update every 15 s per activity, so iOS doesn't throttle Quai.
- Polling only runs for what an enabled flow needs: qBittorrent while a step shows progress,
  Jellyfin availability while an import awaits it, Jellyfin sessions while a playback flow is on,
  health checks while a service flow is on.

## Console

Flows page: list with on/off, edit (name, color, icon, filter, steps picked from the catalog for
the flow's subject, what each step shows, linger, stall and expiry), duplicate, delete (custom
flows), reset (built-in flows), and test (plays the flow's steps on every paired iPhone).
