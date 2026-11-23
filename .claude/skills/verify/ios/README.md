# Verify the iOS app

A Linux session can't build the app. The loop is: catch what TypeScript can, regenerate the
Swift client, then let the `ios` job (macOS) build and photograph the app, and read its result.

## 1. Contract checks (seconds, Linux)

`pnpm --filter @quai/api test`. `test/ios.test.ts` fails when:

- a tag under `/api/*` is missing from `apps/ios/Quai/openapi-generator-config.yaml`
  (`filter.tags`): Swift gets no method for it. Add the tag, or to `leftOutOfTheApp` if the app
  never calls it.
- a schema the app reads holds `Schema.Number` (number or `"Infinity"`/`"NaN"`): Swift gets an
  enum, not a `Double`. Use `Schema.Finite`.

After changing `packages/api`: `pnpm gen:openapi`, commit `openapi.json`. The Swift client
(`apps/ios/Quai/Generated`) isn't committed: the `ios-client` CI job (Linux) generates it with the
generator pinned in `apps/ios/Tools` and hands it to the `ios` job. To read it in a session,
`pnpm gen:client` (`apps/ios/scripts/gen-client.sh`) needs Swift, on Linux too:
`curl -sSfL https://download.swift.org/swift-6.2-release/ubuntu2404/swift-6.2-RELEASE/swift-6.2-RELEASE-ubuntu24.04.tar.gz | tar xz -C /opt/swift --strip-components=1`
(into an empty `/opt/swift`), then `PATH=/opt/swift/usr/bin:$PATH`; the first run builds the
generator (~2 min).

## 2. The preview server (Linux)

`QUAI_PORT=8787 pnpm --filter @quai/cloud preview` (`apps/cloud/test/preview.ts`): the real Quai
Cloud on a port, linked to the tests' fake Quai Home answering from `apps/cloud/test/fixtures`,
dates moved to today, Dune downloading. It is what the screenshots show. Check what the app
will get before pushing:

```sh
code=$(curl -s -X POST localhost:8787/console-api/pairing-codes -H 'content-type: application/json' -d '{"serverUrls":[]}' | jq -r .code)
token=$(curl -s -X POST localhost:8787/api/devices -H 'content-type: application/json' \
  -d "{\"code\":\"$code\",\"name\":\"check\",\"apnsEnvironment\":\"development\"}" | jq -r .token)
curl -s localhost:8787/api/library -H "authorization: Bearer $token" | jq .
```

`pnpm dev:console` against it shows the console on the same home. A screen that needs other
data needs a route in `previewRoutes` (and a fixture, per `fixtures/README.md`).

## 3. Build and screenshots (CI)

Push the branch (`claude/**` triggers `ci.yml` without a PR; once the branch has an open PR, the push run skips `ios` and the PR's run does it). The `ios` job:

1. **Build**: with the client from `ios-client`, `build-for-testing` for a generic simulator, while the simulator boots and the
   preview server starts. Swift errors appear as annotations (xcbeautify). Read them with the
   GitHub MCP tools: `actions_list` for the run, `get_job_logs` with `failed_only`.
2. **Tests and screenshots**: one `test-without-building`. `QuaiTests` holds the unit tests and
   `AppScreenshots.swift`, which pairs a `Connection` to the preview server with a code from the
   console's route (the same pairing as the QR code) and photographs the views in a window of the
   test host: no UI automation, no app launch per screen. Without `QUAI_PREVIEW_URL` the suite is off.
3. **Post**: the PNGs go to the `ios-screenshots` branch (`runs/<run id>/`), the job summary,
   and one comment on the branch's open PR, kept up to date (`.github/scripts/ios-screenshots.sh`).
   Also in the `ios-screenshots` artifact, with `preview.log`.

Look at the PNGs before calling the change done:
`https://raw.githubusercontent.com/mathieuletyrant/quai-app/ios-screenshots/runs/<run id>/<name>.png`
(download with curl, open with Read). A blank or "can't reach" screen is a failure, even when
the job is green.

## Adding a screen

A view worth seeing gets a test in `AppScreenshots`: `show` it (`RootView` on a tab, or the view
itself in a `NavigationStack` or a sheet), wait `until` its data is in the `Connection`,
`settle()`, `screenshot(window, "NN-name")`. Names sort in the comment: keep the number.

## Triage

| Symptom | Cause |
| --- | --- |
| "gave no pairing code" or a pairing error | the server didn't start (`preview.log`), or the pairing failed: the error is in the test log |
| "Waited … for …" | the read never answered: the preview has no route for it, or it failed (`preview.log`) |
| a tile empty or "unavailable" | the preview has no route for that call: see `previewRoutes` |
| "No live bar" | the download (movie-added, grab, torrent snapshot) didn't become an activity |
