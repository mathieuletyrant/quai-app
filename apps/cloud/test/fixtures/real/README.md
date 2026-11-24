# Recorded responses

Answers from a real home on 2026-11-24 (Radarr 7.0.3, Sonarr 4.0.20, Prowlarr 3.1, Seerr 3.5.2,
qBittorrent 5.3.1, Cleanuparr, Reclaimerr 0.6.17; Jellyfin 12.4's are in `../jellyfin`: `users`,
`latest-*`, `episodes-notre-maison`), to the same paths and query strings Quai Home calls.
`test/real.test.ts` runs Quai's adapters on them.

Changed before committing, nothing else:

- users anonymized (names, emails, avatars, Jellyfin and Seerr ids), and the home's domain;
- indexer names and tracker URLs replaced (`Tracker (Prowlarr)`, `https://tracker.example/…`);
  qBittorrent's `tracker`, `magnet_uri`, `comment` and paths other than `save_path` removed;
- lists cut to a few entries (`totalRecords` and the like left as answered), and bulky fields
  Quai never reads dropped (`alternateTitles`, `ratings`, `genres`, `mediaInfo`, `credits`…).

Record again when a service changes its API: the same calls, the same changes.
