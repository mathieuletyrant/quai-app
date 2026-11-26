# App Store screenshots

The iPhone screenshots of Quai's App Store page, 1320 × 2868 (iPhone 6.9").

- `index.html`: the template. Each `<section class="shot">` is one screenshot, and its `id` names the PNG it becomes.
  Each one has a headline, where the `<em>` part takes the accent colour, and a phone. The phone shows either a
  capture of the app from `screens/`, or a Lock Screen drawn in the page: a Live Activity or notifications, laid out in
  iPhone points (402 × 874).
- `screens/`: captures of the app from the CI's `ios` job, which runs the app against the preview server's fake home.
- `render.mjs`: writes `out/<id>.png`, which is not committed.

```sh
node apps/ios/AppStore/render.mjs              # all of them
node apps/ios/AppStore/render.mjs 04-upcoming  # one
```

It needs Playwright with its Chromium (`npm i -g playwright && npx playwright install chromium`). Run it with
`NODE_PATH=$(npm root -g)` when Playwright is installed globally. Open `index.html` in a browser to see every shot
while you edit.

## Refreshing a capture

The `ios` job of each PR posts its captures to the `ios-screenshots` branch, under `runs/<run id>/`. To take the latest:

```sh
git fetch origin ios-screenshots
run=$(git log -1 --name-only --format= FETCH_HEAD | head -1 | cut -d/ -f2)
git show FETCH_HEAD:runs/$run/01-home-upcoming.png > apps/ios/AppStore/screens/upcoming.png
```

| Screenshot | Capture |
| --- | --- |
| `04-upcoming` | `01-home-upcoming.png` → `screens/upcoming.png` |
| `05-home` | `01-home.png` → `screens/home.png` |
| `06-search` | `07-search.png` → `screens/search.png` |

The captures have no status bar: the template draws one, with the Dynamic Island, over them.
