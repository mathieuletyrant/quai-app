# iOS app

Rules for agents working in `apps/ios`, on top of the root [`AGENTS.md`](../../AGENTS.md).

- Quai's refusals become a `ConnectionError` in `QuaiErrorsMiddleware` only (from the answer's `_tag` and `message`), proxy refusals in `AccessHeadersMiddleware`. A call reads only its success with the generated throwing accessors (`try await client.listFixes().ok.body.json`, `.noContent`): no `switch` over an `Output`, no error message per route.
- Without a Mac, the `verify` skill's `ios` scenario (`.claude/skills/verify/ios/`) is the loop: `pnpm test` checks the contract for the generated client (`packages/api/test/ios.test.ts`), the CI generates it (`ios-client`, Linux), the preview server (`pnpm --filter @quai/cloud preview`: real Quai Cloud, fake Quai Home on the fixtures) serves the app, and the `ios` CI job builds, tests and posts screenshots of the views paired to it (`QuaiTests/AppScreenshots.swift`) (a push to `claude/**` is enough). A view change is done when its screenshot looks right.
