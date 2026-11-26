# Alerts

An **alert** is something wrong that may last: a service that stopped answering, the media disk
filling up, a problem an *arr reports about itself. It isn't a Live Activity, which follows
something that moves and ends soon (a download, a playback): a Live Activity left on the Lock
Screen for days says nothing new, and iOS ends it after 8 hours anyway. An alert is a plain
notification when it starts, another when it's over, and a line on the app's Home while it lasts.
What the stack has done on its own (a deletion carried out) is not an alert but *gone*: see
[ADR 2](adr/0002-gone-is-not-an-alert.md).

## The alerts

| Alert | Read from | Starts | Over | Setting |
| --- | --- | --- | --- | --- |
| Service down | each service Quai Home reaches, its status endpoint, every minute | no answer (or a 5xx) for N minutes | the first answer | N, 5 by default |
| Disk low | each media disk (the disks holding Radarr's and Sonarr's root folders, `/api/v3/diskspace` and `/api/v3/rootfolder`), every 10 minutes | under N % free | N + 2 % free, so it doesn't flap | N, 10 by default |
| *arr health | Radarr's and Sonarr's `/api/v3/health`, Prowlarr's `/api/v1/health`, every 5 minutes | a check at the level or above appears | the check is gone | warnings and errors, or errors only (default) |
| Planned deletion | Reclaimerr's `/api/v1/candidates`, every minute | Reclaimerr plans to delete (or move) a title on its own, and again on its last day | deleted, kept, or let go in Quai: without a notification | on or off |

Each is on by default and turned off in the console's **Alerts** page. A kind turned off ends its
alerts without a notification and stops its reads.

## How it works

- Each source is an integration's `alertWatcher` (`health.ts`, `disk.ts`, `arrHealth.ts`, `plannedDeletionAlert.ts`): its
  reading is an `AlertState`, *every alert of this kind and scope going on now* (scope: a service,
  or `disk`; with several media disks, `disk:<id>` each, named by what they hold: "The Shows disk is
  running low"). Those not listed are over. A reading that knows nothing new says nothing. A planned
  deletion is one alert per title, its id changing on the last day: the first days' alert ends
  silently (`silentOver`) and the last day's starts with its own notification.
- Settings saved before a kind existed get that kind's defaults; the others are kept.
- `Alerts.apply` compares it with the alerts going on, kept by Quai Home in `alerts/active`, so a
  restarted Cloud doesn't notify again. What starts and what ends is one notification each and one
  journal line (`alert.raised`, `alert.over`). One still going only gets its text updated (the
  disk's free space), without a notification.
- Notifications are APNs `alert` pushes on the app's own topic, with the same key as the Live
  Activities, to every iPhone that sent a notification token and didn't mute that kind
  (`mutedAlerts` in its preferences, Settings → Notifications in the app).
- Settings live in `alerts/settings` at home. `GET /api/alerts` gives the app the alerts going on
  and the kinds turned on, for the Home's Alerts tile.
