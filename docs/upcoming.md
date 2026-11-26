# Upcoming

What the stack will do on its own, by date, in the iOS app (words: [GLOSSARY](../GLOSSARY.md)). It only
shows: acting on a row happens where it already can (To fix). No console page.

## The screen

- Opened from the Home's **Upcoming** tile, which replaces the Today tile and `ReleasesView`. The tile
  shows today's rows and one line on what goes this week ("1 Reclaimerr deletion this week").
- Filters **All / Coming / Going**, then periods **Today**, **This week** (next 7 days), **This month**
  (next 30 days), **Later**. Rolling from today, not calendar weeks or months.
- A row: the service's name in small coloured capitals above the title (blue for what comes, orange for
  what goes), the title (cut when long, the episode always shown), the date. Today shows the time only; elsewhere the weekday and
  date ("Wed Dec 16", a range "Thu–Sun, Nov 26–29", across months "Mon Nov 30 – Sun Dec 6"). The date line
  never wraps. Nothing about the download's progress.
- After the date, **· +74 GB** in green, only when the space really comes back at that row's moment (see
  Space back). Otherwise nothing.
- A release opens its title, as the Library does. A deletion or a stuck removal opens To fix, where its
  card is. A seed cleanup opens nothing.

## Coming

Monitored movies and episodes **without a file** that Radarr and Sonarr release in the next 14 days. A
title leaves the list once imported, even on its day. A series' episodes of one day are one row ("S02E05–E06"), at the
first one's time. Seerr requests: later.

## Going

- **Reclaimerr**: deletions in state `scheduled`, `eligible` or `postponed`, at the run of its deletion
  task (`GET /api/v1/tasks/delete_cleanup_candidates`, its next run and its cron or interval) from
  `auto_delete_eligible_at` on: "today 03:00", not the day the delay ends. Not `disabled`, `protected` or
  `canceled`, and none while the task is off. Without the task (a key lacking `tasks:read`, Quai Home
  before protocol 11) or a schedule Quai can't follow, "earliest" the day the delay ends.
- **Cleanuparr**, stuck removals: one row per download, "Earliest 14:30", since it goes only if still stuck.
- **Cleanuparr**, seed cleanups (download cleaner): one row per week ("14 torrents"). Due at completion +
  the rule's max seed time, then the job's next run. Public torrents removed at once are not shown;
  ratio-only rules, with no date, are grouped apart.

## Space back

With hardlinks a title's space comes back only when its library copy and every torrent seeding the same
files (cross-seeds too) are gone. So the "+X GB" sits on the row of the **last** of these: a Reclaimerr
deletion whose torrent still seeds shows nothing, and its size shows on the week its seed cleanup lands.

- Library → torrent: the *arr history's grabs (`downloadId`, the torrent hash), read from a day before
  the oldest torrent. A season pack names its season; a multi-season pack is the whole series.
- Hardlinks or copies: Radarr's and Sonarr's media management setting.
- A title the *arr lists with no file is gone; one it doesn't list may have been removed without its
  files: not gone.
- A Reclaimerr movie version is the Radarr movie only when they weigh the same (within 2 %).
- Cross-seeds: same name and size in qBittorrent. A torrent Quai can't place (no grab: added by hand,
  older than the history, another name) keeps a hardlinked deletion from freeing anything when it may
  hold its files: about the same size (within 5 %), or every word of the title in its name.
- A seed cleanup's date is exact for a seed time; the latest for a rule with a ratio too; the earliest
  (maybe never) for a rule that waits for seeders or inactivity. A row gets the space only when its
  moment is surely the last copy going.
- A Cleanuparr rule Quai can't evaluate (trackers, privacy unknown) before the one that matches: the
  torrent has no plan. A stopped torrent gets no closer to its limits.
- qBittorrent didn't answer: the releases, deletions and stuck removals stay; the seed cleanups (made
  from its torrents) and the "+X GB" go, and a line says so.

## States

A service Quai Home doesn't reach is never mentioned. One that didn't answer gets a line at the top
("Cleanuparr didn't answer: …"). Quai Home offline: the whole screen says Quai Cloud isn't reachable.

## Built once

- Releases are read for a range of days; Today's releases, the tile and the Live Activity read one day.
- Deletions and stuck removals come from the functions that feed To fix and the Planned deletion alert.
- Allowlist additions (Quai Home protocol 9): Cleanuparr `GET /api/configuration/download_cleaner` and
  `GET /api/jobs/DownloadCleaner`, Radarr's and Sonarr's `GET /api/v3/config/mediamanagement`. The
  history and the finished torrents were already allowed.
- Code: `upcoming/Rows.ts` (the rows), `reclaimerr.ts` `plannedDeletions` (the planned deletions, read once), `upcoming/SpaceInputs.ts` and `upcoming/SpaceBack.ts` (the space),
  `seedCleanups` in `integrations/cleanuparr.ts`, all pure and tested; `upcoming/Upcoming.ts` only reads.

## Later

The disk projection curve, Seerr requests in Coming, a "Keep seeding" button.
