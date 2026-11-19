# Fixtures

Responses and webhook payloads from the stack, keys and file paths masked.

These first ones are written from the services' documented payloads (Radarr v5, Sonarr v4,
qBittorrent 5 Web API v2, Jellyfin 10.10), trimmed to realistic fields. Replace them with
recordings from the real stack once `record-fixtures` exists (docs/spec-v1.md, Tests).

The library reads (`radarr/movies.json`, `radarr/diskspace.json`, `sonarr/series.json`) follow
the shape of Radarr v5's `GET /api/v3/movie` and `GET /api/v3/diskspace` and Sonarr v4's
`GET /api/v3/series`, trimmed to a few titles.
