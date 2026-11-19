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
episodes without an air date (no `nextAiring`, statistics 0 of 0).

The To fix reads follow Radarr v5 and Sonarr v4's `GET /api/v3/queue` (with `includeMovie`, or
`includeSeries` and `includeEpisode`), `GET /api/v3/wanted/missing`, `GET /api/v3/history/since`,
`GET /api/v3/release`, `GET /api/v3/manualimport` and Sonarr's `GET /api/v3/episode`;
`reclaimerr/candidates.json` follows Reclaimerr 0.6's `GET /api/v1/candidates`
(`CandidateListResponse`, backend/models/api_v1/candidates.py). Hashes, guids and magnets are
masked.
