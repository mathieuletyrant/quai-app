# Fixtures

Responses and webhook payloads from the stack, keys and file paths masked.

These first ones are written from the services' documented payloads (Radarr v5, Sonarr v4,
qBittorrent 5 Web API v2, Jellyfin 10.10), trimmed to realistic fields. Replace them with
recordings from the real stack once `record-fixtures` exists (docs/spec-v1.md, Tests).

The library reads (`radarr/movies.json`, `radarr/diskspace.json`, `sonarr/series.json`) follow
the shape of Radarr v5's `GET /api/v3/movie` and `GET /api/v3/diskspace` and Sonarr v4's
`GET /api/v3/series`, trimmed to a few titles. `radarr/movie-unmonitored.json` and
`sonarr/series-unmonitored.json` are a movie and a series left unmonitored without a file (watched,
then deleted); `sonarr/series-announced.json` is a monitored series added before anything aired, its
episodes without an air date (no `nextAiring`, statistics 0 of 0). `radarr/movie-by-tmdb.json` is
`GET /api/v3/movie?tmdbId=693134`: Dune, out (`isAvailable`, Radarr's "Missing" rather than "Not
Available").

The To fix reads follow Radarr v5 and Sonarr v4's `GET /api/v3/queue` (with `includeMovie`, or
`includeSeries` and `includeEpisode`), `GET /api/v3/wanted/missing`, `GET /api/v3/history/since`,
`GET /api/v3/release`, `GET /api/v3/manualimport` and Sonarr's `GET /api/v3/episode`;
`reclaimerr/candidates.json` follows Reclaimerr 0.6's `GET /api/v1/candidates`
(`CandidateListResponse`, backend/models/api_v1/candidates.py); `reclaimerr/events-deleted.json` its
`GET /api/v1/events?event_type=candidate.deleted` (`EventFeedResponse`, models/api_v1/events.py,
the payload a `CandidateFileEvent`): Severance's first season, then Up. Hashes, guids and magnets are
masked.

`seerr/` follows Jellyseerr 2's API (`overseerr-api.yml`): `GET /api/v1/request?filter=pending`
(`requests-pending.json`, a movie and a series asked by Julie), `GET /api/v1/request/{id}`
(`request-approved.json`), `GET /api/v1/movie/{id}` and `GET /api/v1/tv/{id}` (`movie.json`,
`tv.json`, trimmed, with Severance's seasons: specials, 1 in the library, 2 asked for, 3 not out
yet), `GET /api/v1/search?query=dune` (`search-dune.json`: movies, a series, a person and a
collection; Dune in the library, Part Two on its way), `GET /api/v1/tv/90228`
(`tv-prophecy.json`, Dune: Prophecy, nothing asked yet), `GET /api/v1/user` (`users.json`,
Mathieu and Julie), and `POST /api/v1/request` (`request-created.json`, auto-approved).
`webhook-*.json` are what Seerr posts with Quai Home's payload template
(apps/home/src/SeerrWebhook.ts): pending, approved, declined, an auto-approved request (it must
start nothing) and the test notification.

Today's releases: `sonarr/calendar.json` follows Sonarr v4's `GET /api/v3/calendar?includeSeries=true`
for Friday Nov 20, 2026 (an unmonitored episode and one airing after midnight in Paris are the
ones left out), `radarr/calendar.json` Radarr v5's `GET /api/v3/calendar` (a movie in cinemas only
and one out the next day are left out); `*/queue-calendar.json` are their queues without the
series, episode or movie.

`cleanuparr/` follows Cleanuparr 2.11.1's API (code/backend/Cleanuparr.Api, camelCase JSON, enums
as strings): `GET /api/strikes` (`strikes.json`, `PaginatedResult<DownloadItemStrikesDto>`: The
Wild Robot stalled twice and Amazing Stories' import failed twice, one strike from their limit;
Mouse struck once; Dune struck only in dry run; Night of the Living Dead no longer in a queue; Old
Movie already removed), `GET /api/configuration/queue_cleaner` (`queue-cleaner.json`,
`QueueCleanerConfigResponse`), `GET /api/queue-rules/stall` and `/slow` (`StallRuleResponse`,
`SlowRuleResponse`), `GET /api/jobs/QueueCleaner` (`job-queue-cleaner.json`, `JobInfo`) and
`GET /api/events?eventType=DownloadCleaned` (`events-cleaned.json`: Fool Night cleaned after
seeding, and a dry run), `GET /api/events?eventType=QueueItemDeleted` (`events-removed.json`, `PaginatedResult<EventListItem>`,
one of them a dry run). Their download ids are the Radarr and Sonarr queue fixtures'.
