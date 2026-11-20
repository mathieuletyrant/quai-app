---
name: verify-live-activity-pushes
description: Model-check (TLA+/TLC) that the iPhone ends on what Quai's engine has for a Live Activity, whatever order the event fiber and the heartbeat fiber send their pushes in. Use when a change touches Activities.ts, Notifier.ts, Hub.ts (apply, beat, handle), Targeting.ts (deliveryFor) or Engine.ts (onEvent/onTick pushes), or when asked to "model-check the pushes", "verify the Live Activity order" or "prove the pushes".
---

# Verify the Live Activity pushes

**The promise.** Once every push is sent, the iPhone shows a Live Activity exactly while the
engine runs it (`ActivityWhileRunning`), at the engine's latest change (`LatestShown`), and
never two of the same key (`OneActivity`).

**The harm.** A download that the lock screen shows as still running long after it ended, a
new one that never appears, or a step older than the real one, until the next push.

## Run it

```sh
apps/cloud/verification/verify.sh
```

It needs Java 11+, and takes a few seconds. It downloads `tla2tools.jar` once into
`~/.cache/quai/`, or uses `TLA2TOOLS_JAR=<path>`. It checks each invariant on two designs and
compares each result with the one expected today:

| Design (`SendUnderLock`) | `OneActivity` | `ActivityWhileRunning` | `LatestShown` |
| --- | --- | --- | --- |
| `FALSE`: the code as it is | pass | **fail** (finding 2) | **fail** (finding 1) |
| `TRUE`: pushes sent before the permit is released | pass | pass | pass |

Exit 0: nothing changed. Exit 1: a result differs from that table, marked `!!`, with TLC's
counterexample. Exit 2: TLC didn't run (a syntax error in the model).
`LiveActivityPushes.cfg` (everything, code as it is) and `UnderLock.cfg` can be run by hand:
`java -jar tla2tools.jar -deadlock -config UnderLock.cfg LiveActivityPushes.tla`.

## Findings (open, product code unchanged)

`Activities.run` computes the pushes under a one-permit `Semaphore`, but the caller hands them
to `Notifier.send` after the permit is released. Two fibers call it: the event fiber
(`Hub.layerFed`: `handle` → `apply`) and the heartbeat (`Hub.layer`: `beat`, every 5 s). Their
pushes can reach APNs in the opposite order from the one the engine made them in, and
`apnsBody` stamps each one with the time it is sent, so iOS keeps whichever arrives last.

1. **`LatestShown`.** The engine makes Start (v1, event fiber), then the heartbeat makes an
   Update (v2). The heartbeat sends v2 first, then the event fiber sends v1. The iPhone shows
   v1 until the next push.
2. **`ActivityWhileRunning`.** The heartbeat ends an expired activity (End). An event about
   the same key then gets there first, and since `shown` is still set, it goes out as an Update
   to the old token. The End follows and ends the activity on the iPhone, while the engine
   runs it again. The reverse order (End made after a Start that was not sent yet) leaves an
   activity on the iPhone that will never get its End. The shortest trace TLC prints for this
   one has the heartbeat end an activity it just started, which onTick only does after
   `expireAfterMinutes` without an event. The real window is that expiry meeting an event,
   rarer than the trace suggests.

The fix the model supports: send the pushes while holding the permit (or per key, in engine
order). If the code changes that way, move the table's `FALSE` row expectations to pass in
`verify.sh` once the model's `Compute`/`Deliver` describe the new code.

## Reading a result

- **A real bug.** The trace's steps exist in the code: each `Compute(f)` is an
  `Activities.run` (under the permit), each `Deliver(f)` is one `Notifier.one` for one iPhone,
  and the order between them is free because nothing orders the two fibers. Tell it as steps
  in those words. If the `/statechart` skill is available, use it to read a TLA+ trace or draw
  the states.
- **A modeling error.** A step the code can't take: a fiber computing while its previous
  pushes are still unsent (each fiber is sequential: `pending[f] = <<>>` guards that), the
  heartbeat starting an activity (onTick never starts one), or an atomic step split where the
  code has no yield. Fix the model, not the property.

## What is covered, and what isn't

Covered, at the sync commit:

| Code | Model |
| --- | --- |
| `apps/cloud/src/flows/Activities.ts`: `run` (permit around compute, released before return) | `Compute`, `lock` |
| `apps/cloud/src/integrations/Hub.ts`: `apply`, `beat`, `layerFed`, `layer` | the two fibers, `EventChange`/`TickChange` |
| `apps/cloud/src/push/Notifier.ts`: `one` (deliveryFor, `shown.add`/`delete`, `apns.send`) | `Deliver`, `shown` |
| `apps/cloud/src/flows/Targeting.ts`: `deliveryFor`, no swipe, tokens known | `Deliver`'s branches |
| `apps/cloud/src/flows/Engine.ts`: which pushes `onEvent`/`onTick` can make | `EventChange`, `TickChange` |

Bounds and assumptions: one activity key, one iPhone with its push-to-start and activity tokens
known, no swipe (`dismissed`), at most 5 engine runs for the code as it is and 7 for the fixed
design. APNs delivers to one device in the order it receives. Expiry timing is not modeled:
the heartbeat may end a running activity at any step.

Not covered: several iPhones or keys, swiped-away activities, `Notifier.sendTo` (test
buttons), timeouts and retries of `apns.send`, Quai Home disconnecting mid-push, and the
iPhone's own play/pause shown at once (`PendingPlayback`).

**Sync commit: `a7aa6ae`.** The verification describes the files above as they are at this
commit. Before trusting a pass, run
`git diff a7aa6ae -- apps/cloud/src/flows/Activities.ts apps/cloud/src/push/Notifier.ts apps/cloud/src/integrations/Hub.ts apps/cloud/src/flows/Targeting.ts apps/cloud/src/flows/Engine.ts`.
If one of those diffs touches what the table maps, update the model, then move this commit
forward only after checking the model describes the code at the new commit.

## Changing the model

`apps/cloud/verification/LiveActivityPushes.tla`. Its header says which code each part stands
for: keep it true. A new property gets a line in `checks` in `verify.sh`, and it is shown failing
on a broken variant first (e.g. setting `shown' = TRUE` on End, like dropping `shown.delete(k)`
in `Notifier.one`, flips every result). A check never seen failing proves nothing.
