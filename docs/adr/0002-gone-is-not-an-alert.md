# 2. Gone is not an alert, and is read from the services' events

Nov 25, 2026 · Accepted

## Context

Upcoming shows what the stack will remove on its own (*going*): Reclaimerr's planned deletions,
Cleanuparr's stuck removals and seed cleanups. The user wanted to hear when one of them has
happened: "Vampire Diaries S07 is gone".

The Planned deletion alert already ends when its title leaves Reclaimerr's candidates, silently,
because Quai can't tell why it left: deleted, kept in Reclaimerr, the rule changed. And a title the
user let go has no alert at all, so its deletion would go unseen.

## Decision

**Gone** (GLOSSARY) is its own kind of notification, not the end of an alert.

- An alert is *something wrong that may last*, notified when it starts and when it's over, shown on
  the app's Home. Something gone is neither wrong nor lasting: one notification, one journal line,
  nothing on the Home.
- It is **read from what the service says it did**, never inferred from something disappearing:
  Reclaimerr's event feed (`GET /api/v1/events`, `candidate.deleted`, `candidate.unmonitored` (unmonitored in its *arr with its files deleted) and
  `candidate.moved`, which
  needs the `events:read` scope on its token) and Cleanuparr's events (`QueueItemDeleted`,
  `DownloadCleaned`). Reclaimerr's webhooks were ruled out: no token scope can create them.
- It is **turned on per iPhone and per kind** (`DevicePreferences.gone`), off by default: it is a
  preference of the person, not a setting of the home. The Cloud watches the feeds only while one
  iPhone wants them.
- **Let it go doesn't silence it**: letting a planned deletion go accepts it, it doesn't ask not to
  know.
- What happened more than an hour ago (Quai Home away, a Cloud restart) is written to the journal,
  not notified: it would come too late to be worth a sound.
- The space that came back is said only when it surely did (*space back*). Reclaimerr's event
  doesn't carry the size: Quai remembers each candidate's size from its last read, and says
  nothing when it never read it.

## Consequences

- Reclaimerr's event feed is always watched while an iPhone wants Gone · Planned deletion. (Until
  ADR 3's old path was removed, a Quai Home older than protocol 10 refused it and Gone stayed quiet
  there; a Quai Home older than 13 no longer links.)
- A Reclaimerr token without `events:read` keeps working for everything else; the console's
  Services page says the scope is missing.
- A new thing that happened on its own (a request available, a release grabbed) would be another
  Gone kind only if it was *going* first; otherwise it belongs to a flow.

## Amended

Nov 26, 2026: the disk readings ([#153](https://github.com/mathieuletyrant/quai-app/issues/153))
place each gone on the media disk's chart, kept for good. The Cloud now watches Reclaimerr's and
Cleanuparr's events whenever Quai Home reaches them, not only while an iPhone wants Gone; it still
notifies only the iPhones that turned it on.
