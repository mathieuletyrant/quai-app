# Glossary

The words Quai's code, docs and reviews use for its moving parts. One name per thing. A word under
_Avoid_ names the same thing and shouldn't be used for it.

## The home and the two servers

**Home**. One household's media stack and everything Quai keeps for it: its services, its paired
iPhones, its flows, its journal. It has one Quai Home and a home id (the fingerprint of the Quai
Home's key). Not the app's Home tab.
_Avoid_: tenant, account, server

**Quai Home** (`apps/home`). The server that runs at home, next to the services, with their URLs
and keys. It opens one WebSocket to Quai Cloud, runs the calls and watches the Cloud asks for
within the allowlist, forwards webhooks, and keeps the home's documents (paired iPhones, flows,
activities) on its `/data` volume. It serves the console. Always named in full.
_Avoid_: "home" alone for the server, the agent, the bridge

**Quai Cloud** (`apps/cloud`). The server the app talks to, and the console through Quai Home. It
runs the flows and pushes to APNs, from what Quai Home reads and sends. It serves no interface and
keeps nothing: no database, nothing on disk; the home's documents are in memory while the home is
linked. One Quai Cloud serves many homes.
_Avoid_: the backend, the server (when it could be Quai Home)

**Home documents** (`HomeStore`). What Quai keeps for a home (iPhones, flows, running activities,
alert settings, hidden fixes), stored by Quai Home and read by the Cloud over the home link.

**Service**. One app of the media stack Quai talks to: Radarr, Sonarr, Prowlarr, qBittorrent,
Jellyfin, Seerr, Reclaimerr, Cleanuparr.
_Avoid_: app, integration (that is the Cloud's module for a service)

**Service settings** (`ServiceSettings`). Each service's address and key, as Quai Home uses them:
from an environment variable (`QUAI_RADARR_URL`…), which wins, or from the console's **Services
page**, saved in `/data/services.json`. A change applies at once and Quai Home tells the Cloud which
services it reaches (`ServicesChanged`), never their keys. A key is write-only: the console shows
that one is set, never its value.

**Console** (`apps/console`). The web pages to set Quai up, served by Quai Home behind its
password (`QUAI_HOME_PASSWORD`, a 30-day session cookie). Its own routes are Quai Home's
(`/home-api`, `HomeConsoleApi`); the rest (`/console-api`) are Quai Cloud's, relayed.
_Avoid_: dashboard, admin

**Console relay** (`ConsoleRequest`, `ConsoleResponse`). Quai Home passes the console's
`/console-api` requests to Quai Cloud over the home link, and the Cloud answers them with its own
routes. The Cloud's public port refuses `/console-api`: only what Quai Home relays gets an answer.
See [ADR 1](docs/adr/0001-console-served-by-quai-home.md).

**Home link** (`HomeLink`, `HomeLinks`). The WebSocket between the two, its handshake, and the
messages on it (`packages/api/src/Home.ts`, `HomeProtocol`). `HomeLinks` serves every Quai Home's
WebSocket; each home's services read their own `HomeLink`, never another's. Features don't call
through it themselves: their calls go through `HomeReads`, the watches through the Hub.

**Home app** (`HomeApp`, `Homes`). One home's services and routes on its own link: stores, engine,
Hub, journal, the whole API and the console relay. Quai Cloud builds one per home when its Quai
Home links (`Homes`), forgets it an hour after it went away, and sends each request to its home's
app: an iPhone's by its device token, a pairing by its code, the console's by the link it came
over. What no home claims gets an app on no home: `/api/health`, and 503 for the rest.

**Home read** (`HomeReads`). A call the Cloud has Quai Home make to a service when it needs the
answer now: a GET (`read`, `all`) or a write (`write`). One policy for all of them: Quai Home gone
is *offline*; a service that didn't answer as expected is *unavailable* (None, logged with its
service and path, never what it answered), or a refusal in words for a write. Reads of the same
GET at once share one call, and its 2xx answer serves them for a few seconds (`answerKeptMs`): a
screen's routes, asked together, read the same lists once. A write forgets what was kept.

**Watch**. A GET Quai Home polls on its own, every few seconds to an hour, while a flow needs it
(or the journal: Cleanuparr's removals, while Quai Home reaches it), sending a snapshot when the
answer changes. The Hub sets the list; Quai Home stops polling when the link drops.
_Avoid_: subscription, poller

**Allowlist** (`HomeProtocol.allowlist`, `allowRule`). The method, path and, for some writes, body
checks of everything the Cloud may ask Quai Home to call or watch. Quai Home enforces it: a
compromised Cloud can't read settings (but for Cleanuparr's queue cleaner, which holds no secret)
or delete a library. The Cloud's tests run against a fake
Quai Home that enforces it too (`apps/cloud/test/fakeHome.ts`), so a path it refuses fails them.

**Checked against** (`AllowRule.against`). A write that replaces a whole document of a service
(Cleanuparr's queue cleaner settings): Quai Home reads the document first and sends the write only
if the rule's check of the two passes, so the Cloud changes the one field it may change.

**Offline** (`HomeOffline`, 503). Quai Home and Quai Cloud aren't linked (no `QUAI_CLOUD_URL`, the
Cloud down, or the link dropped during the request). Nothing can be read: the whole answer fails,
it is never a partial one. The console says "Quai Cloud isn't reachable".

**Unavailable** (`unavailable: [...]`, a 200). Quai Home is linked, reaches the service, but the
service didn't answer as expected this time (timeout, refused call, non-2xx, unreadable body). The
other services still show. A service Quai Home doesn't reach at all is neither: it is skipped.
Not the *service down* alert, which is unavailable for minutes in a row.

**Demo home**. A home with no stack: Quai Cloud linked to a fake Quai Home answering from recorded
responses, on demo.quai.stream, for App Review. Paired with the code `QUAIDEMO`; no Live Activity.

## iPhones

**iPhone** (`Device`, `DeviceId`). An iPhone paired with a home: the app on it, its notification
and Live Activity tokens, its preferences. The code says *device*, words people read say *iPhone*.
_Avoid_: device in UI text, client, phone. A Jellyfin *device* (a TV, a player) is never an iPhone.

**Pairing** (`PairingCode`). Linking an iPhone to a home: the console shows a short-lived code and
its QR link, the app sends it back and gets its device token.

**Device token** (`DeviceToken`). An iPhone's bearer token, `<home id>.<secret>`, kept by its home
as a hash only. The home id routes the request; the secret is checked by that home. Tokens issued
before Quai Cloud served several homes are the secret alone: the linked home that holds it answers.

**iPhone preferences** (`DevicePreferences`). What one iPhone chooses for itself, in the app: which
flows and steps it shows, the alerts it mutes, its requester.

**Home tiles** (`homeTiles`). The tiles of the app's Home tab (To fix, Requests, Upcoming, Alerts,
Recently added and Wanted side by side, Storage), in the order an iPhone chose, without the ones it
hid. Part of its preferences. A tile with nothing to show stays out wherever it is placed.
_Avoid_: dashboard, widgets

**Requester** (`seerrUserId`). The Seerr user an iPhone requests titles as; Seerr's admin (the
owner of Quai Home's key) when it chose none.

## Flows and Live Activities

**Flow** (`Flow`). The description of one kind of Live Activity: its subject and filter, its steps,
and when it ends. Built-in flows (Download, Jellyfin playback, Requests, Today's releases) can be edited and
reset; custom flows are made from the same pieces.
_Avoid_: automation, rule, workflow

**Subject** (`FlowSubject`). What one activity follows: a title's download (*media*), a Jellyfin
*playback*, a Seerr *request*, or a *day*.

**Step** (`FlowStep`). One stage of a flow, entered by one catalog event, with what it shows
(progress, timer, list…) and the actions it offers. 1 to 6 per flow.

**Event** (`EventType`, the catalog). Something a service did, normalized by its integration
(`media.grabbed`, `playback.started`, `request.pending`). A *step event* moves an activity to its
step; a *data event* only updates the current step's values. Not a journal line, and not a service's
own events (Cleanuparr's `QueueItemDeleted`).

**Action** (`ActionType`). A button a step offers on the Live Activity (Play/Pause, Stop, Approve,
Decline), run by the service through Quai Home. Not a fix's buttons.
_Avoid_: intent, command

**Activity** (`Activity`, `RunningActivity`). One run of a flow for one subject, kept by the Cloud:
its step, its values, its tone (*active*, *stalled*, *done*). At most one per flow and subject.

**Live Activity**. An activity as one iPhone shows it, on the Lock Screen and in the Dynamic
Island, kept up to date by pushes. One activity can be several Live Activities, one per iPhone, each
with only the steps that iPhone shows.

**Stalled**. An activity whose progress hasn't moved for the flow's time, or whose import is
blocked: drawn grey until it moves again.

**Engine** (`Engine`). The pure rules that turn events into activities: start, move forward, end,
stall, expire.

**Integration** (`Integration`, `apps/cloud/src/integrations/`). Everything Quai Cloud knows about
one service: its webhook reader, its watches, its actions, its alert sources.

**Hub** (`Hub`). What runs the integrations for one home: it sets the watch list, hands snapshots
and webhooks to their integration and the events to the engine, and beats every 15 s.

**Live bar** (`LiveBar`). The bar above the app's tab bar while something plays or downloads, one
running activity at a time.

## Titles and the stack

**Title**. A movie or a series, as Radarr, Sonarr, Seerr and Jellyfin know it, matched across them
by its TMDB, TVDB or IMDb id.
_Avoid_: media, item (in words people read)

**Library** (`Library`). The titles Radarr and Sonarr hold, with their status (available,
downloading, wanted…), read in the app.

**Disk readings**. Each media disk's free space, read every hour and kept for good, so a cleanup
can be told from a grab. Shown in the app's **Storage** screen, opened from the Home's storage tile.
_Avoid_: disk history (history is the *arr's)

**Media disk**. A disk that holds a Radarr or Sonarr root folder. Radarr and Sonarr list every
mount they see, the same disk several times: two mounts of the same size and free space are one
disk. The disk low alert and the disk readings are per media disk.

**Disk mark**. Something that happened, placed on the disk readings so a rise or a drop can be read:
a *gone* (what Upcoming showed as going, done), or an *arrived* (a title's files imported, one mark
per title and day). Only what a service said it did; a change no mark explains stays unexplained.

**Request** (`MediaRequest`). A Seerr request for a title. The Requests flow and screen follow the
ones *pending*: waiting for an approval. One Seerr approved on its own never waits and isn't shown.

**Download**. A release grabbed for a title, in the download client and in Radarr's or Sonarr's
queue until it is imported. Its download id is the torrent's hash (or the SABnzbd job).
_Avoid_: torrent (when it isn't qBittorrent's side), queue item

**Release**. What an indexer offers for a title, to grab: one torrent or NZB with its quality,
size and seeders. "Search releases" lists them.
_Avoid_: result, torrent. Not a release day.

**Release day**. The day a title comes out: an episode airing, a movie out digitally or on disc (a
cinema release doesn't count). What Today's releases and Upcoming's *coming* rows are made of.
_Avoid_: "release" alone, airing, calendar entry

**Today's releases**. The built-in flow of subject *day*: one activity for the home's day, listing
its release days and how many already have their file ("2 of 5 here").

**Home time**. The time zone a home's day follows: the one the most recently seen iPhone reports,
else Quai Cloud's `QUAI_TZ`, else UTC.

## What can go wrong

**Journal** (`Journal`, `packages/api/src/Journal.ts`). What Quai did, one plain line per thing:
a webhook and what it meant, an activity's steps and the iPhones it reached, Apple's refusals, a
service that stopped answering and came back, Quai Home linked or gone, a button pressed and how it
went. Never a token or a key. Quai Cloud keeps the last 200 lines in memory for the console's live
view and hands the rest to Quai Home in batches (`JournalAppend`); Quai Home keeps 7 days, at most
5000 lines, in `/data/journal/` (one JSON line per entry, one file per UTC day), with its own lines
(webhooks in, allowlist refusals, services it can't reach). The console reads pages back with
`JournalRead`.
_Avoid_: log, history (that is the *arr's)

**Alert** (`Alerts`, `packages/api/src/Alerts.ts`, `apps/cloud/src/alerts/`). Something wrong that
may last: a service that stopped answering (*service down*), the media disk under a share of free
space (*disk low*), a problem Radarr, Sonarr or Prowlarr report on their System > Status page (*arr
health*), a planned deletion. Not a Live Activity: one notification when it starts, one when it's
over. Set up in the console's Alerts page, muted per iPhone in the app; the ones going on show on
the app's Home. See [docs/alerts.md](docs/alerts.md).
_Avoid_: incident, warning

**To fix** (`Fixes`). The app's list of what needs a decision from someone, worked out each time
it is read, from fixed rules. Nothing is kept but what the user hid.

**Fix** (`Fix`, `FixKind`). One entry on the To fix list: *import blocked*, *no source*, *planned
deletion*, *stuck removal*. Its buttons are its actions (`FixAction`).
_Avoid_: problem, issue

**Import blocked**. A download Radarr or Sonarr won't import without someone: a manual
interaction, or a pending import with a warning.

**No source**. A monitored title out for 2 hours, with no file, nothing in the queue and no grab.

**Ignore and wait** (`ignoreAndWait`). Hiding a fix until a release is grabbed for it, or for some days.
_Avoid_: snooze

**Let it go** (`letGo`). Letting a planned deletion or a stuck removal happen, and hiding its fix.
_Avoid_: dismiss

**Keep**. Stopping a planned deletion (Reclaimerr protects the title) or a stuck removal (Cleanuparr
ignores the download), for good.

## Upcoming

**Upcoming**. What the stack will do on its own, by date, read in the app. It shows two kinds of
things: what is *coming* (the release days of titles without a file) and what is *going* (planned
deletions, stuck removals, seed cleanups). It only shows; acting on one of them happens where it
already can (To fix). Not the queue: what downloads now is an activity.

**Planned deletion**. Reclaimerr removing a title from the library, on its own, at a date it
planned. It is a fix, an alert and an Upcoming row, then *gone* once Reclaimerr did it.
_Avoid_: deletion, scheduled deletion, candidate

**Stuck removal**. Cleanuparr's queue cleaner taking a download that doesn't move out of an *arr
queue once it has enough strikes.
_Avoid_: removal planned, planned removal, strike

**Seed cleanup**. Cleanuparr's download cleaner taking a finished torrent out of qBittorrent once it
has seeded long enough (or reached its ratio), with its files.
_Avoid_: stuck removal (that is the queue cleaner)

**Space back**. When a title's room on the disk really comes back: once its copy in the library and
every torrent seeding the same files (cross-seeds too) are gone. With hardlinks, a planned deletion
or a seed cleanup alone may give nothing back.
_Avoid_: freed space, reclaimed space

**Gone**. What Upcoming showed as *going* that the stack has now done on its own: a planned
deletion Reclaimerr carried out, a stuck removal or a seed cleanup Cleanuparr made. One
notification each, turned on per iPhone and per kind, even for what was let go. Not an alert:
nothing is wrong and nothing lasts.
_Avoid_: deleted, removed, cleanup done
