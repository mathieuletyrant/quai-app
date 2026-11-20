---
name: verify
description: Prove a change to Quai works before calling it done, one scenario per risk. ios: contract checks, the preview server and the CI's simulator screenshots of the app (no Mac needed). live-activity-pushes: a TLA+ model of the order Live Activity pushes reach the iPhone. Use after touching apps/ios, packages/api, the fixtures, or the engine/push code (Activities.ts, Notifier.ts, Hub.ts, Targeting.ts, Engine.ts), before opening a PR, or when asked to "verify", for "proof", "screenshots of the app" or to "model-check the pushes".
---

# Verify a change

Each folder is one scenario: what it proves, how to run it, how to read a failure, what it
doesn't cover. Find the scenarios your change touches, read their README, run them, and say in
the PR what each one showed.

| Scenario | Run it when the change touches | Proves | Run |
| --- | --- | --- | --- |
| [`ios/`](ios/README.md) | `apps/ios`, `packages/api`, `apps/cloud/test/fixtures`, `apps/cloud/test/preview.ts` | the generated Swift client fits the contract; the app builds, its tests pass, and its screens look right against a real Quai Cloud | `pnpm test`, then a push to `claude/**` (CI, ~10 min) |
| [`live-activity-pushes/`](live-activity-pushes/README.md) | `apps/cloud/src/flows/Activities.ts`, `Engine.ts`, `Targeting.ts`, `apps/cloud/src/push/Notifier.ts`, `apps/cloud/src/integrations/Hub.ts` | the iPhone ends on what the engine has, whatever order the two fibers send in | `.claude/skills/verify/live-activity-pushes/verify.sh` (seconds, Java) |

A scenario that passes proves what its README says, under its bounds: not the rest. A green CI
without the screenshots looked at, or a model whose sync commit is behind the code it covers, is
not a proof yet.

## Adding a scenario

A new folder named after the risk (`kebab-case`), with:

- `README.md`: the promise and the harm in one sentence each, the one command, how to tell a real
  bug from a broken check, what is covered (files, functions, bounds) and what isn't.
- whatever it runs (a model, a script), next to it. Code under test stays where it lives.
- a check seen failing at least once on a broken variant, recorded in its README.

Then a row in the table above.
