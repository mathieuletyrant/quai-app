---------------------------- MODULE LiveActivityPushes ----------------------------
(***************************************************************************)
(* The pushes of one Live Activity (one activity key, one iPhone), from    *)
(* the engine to what the iPhone shows.                                    *)
(*                                                                         *)
(* Two fibers run the engine (apps/cloud/src/integrations/Hub.ts):         *)
(*   "events": Hub.layerFed, link.nextEvent -> handle -> apply             *)
(*             -> engine.handle, then notifier.send                        *)
(*   "beat":   Hub.layer, every 5 s -> beat -> engine.tick,                *)
(*             then notifier.send                                          *)
(* Activities.run (apps/cloud/src/flows/Activities.ts) computes the        *)
(* pushes under a Semaphore of 1 permit and releases it before the caller  *)
(* hands them to Notifier.send (apps/cloud/src/push/Notifier.ts).          *)
(*                                                                         *)
(* One Deliver step is Notifier.one for one push and one iPhone:           *)
(* deliveryFor (apps/cloud/src/flows/Targeting.ts), the update of the      *)
(* `shown` set and apns.send. The code has no yield between deliveryFor    *)
(* and `shown.add`/`shown.delete`, and APNs delivers to one device in the  *)
(* order it receives, so the model treats them as one step.                *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxRuns,       \* bound on engine runs (Activities.run calls)
    SendUnderLock  \* FALSE: the code as it is. TRUE: pushes sent before the permit is released.

Fibers == {"events", "beat"}

VARIABLES
    running,    \* the engine has this activity (state/activities holds its key)
    version,    \* bumped at every engine change: what the iPhone should end on
    runs,
    pending,    \* pending[f]: pushes engine computed in fiber f, not yet delivered
    lock,       \* who holds Activities' permit, or "none"
    shown,      \* Notifier's `shown` set, for this (iPhone, key)
    phoneLive,  \* Live Activities of this key on the iPhone, not ended
    phoneVersion \* the version the iPhone's activity shows

vars == <<running, version, runs, pending, lock, shown, phoneLive, phoneVersion>>

Push(tag, v) == [tag |-> tag, v |-> v]

Init ==
    /\ running = FALSE
    /\ version = 0
    /\ runs = 0
    /\ pending = [f \in Fibers |-> <<>>]
    /\ lock = "none"
    /\ shown = FALSE
    /\ phoneLive = 0
    /\ phoneVersion = 0

(* Engine.onEvent: a flow event starts the activity, moves it, or ends it. *)
EventChange(tag) ==
    \/ /\ ~running /\ tag = "Start" /\ running' = TRUE
    \/ /\ running /\ tag = "Update" /\ running' = TRUE
    \/ /\ running /\ tag = "End" /\ running' = FALSE

(* Engine.onTick: a progress or an expiry of a running activity. *)
TickChange(tag) ==
    \/ /\ running /\ tag = "Update" /\ running' = TRUE
    \/ /\ running /\ tag = "End" /\ running' = FALSE

Compute(f) ==
    /\ runs < MaxRuns
    /\ pending[f] = <<>>
    /\ lock = "none"
    /\ \E tag \in {"Start", "Update", "End"}:
        /\ IF f = "events" THEN EventChange(tag) ELSE TickChange(tag)
        /\ version' = version + 1
        /\ pending' = [pending EXCEPT ![f] = <<Push(tag, version + 1)>>]
    /\ runs' = runs + 1
    /\ lock' = IF SendUnderLock THEN f ELSE "none"
    /\ UNCHANGED <<shown, phoneLive, phoneVersion>>

(* Notifier.one -> deliveryFor, for an iPhone with tokens and no swipe. *)
Deliver(f) ==
    /\ pending[f] # <<>>
    /\ LET p == Head(pending[f]) IN
        IF p.tag = "End"
        THEN IF shown
             THEN /\ shown' = FALSE
                  /\ phoneLive' = phoneLive - 1
                  /\ phoneVersion' = p.v
             ELSE UNCHANGED <<shown, phoneLive, phoneVersion>>
        ELSE IF shown
             \* Shown: an Update to its activity token, whatever the push's tag.
             THEN /\ phoneVersion' = p.v
                  /\ UNCHANGED <<shown, phoneLive>>
             \* Not shown: a push-to-start, a new activity on the iPhone.
             ELSE /\ shown' = TRUE
                  /\ phoneLive' = phoneLive + 1
                  /\ phoneVersion' = p.v
    /\ pending' = [pending EXCEPT ![f] = Tail(pending[f])]
    /\ lock' = IF lock = f /\ Tail(pending[f]) = <<>> THEN "none" ELSE lock
    /\ UNCHANGED <<running, version, runs>>

Next == \E f \in Fibers: Compute(f) \/ Deliver(f)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

Quiet == \A f \in Fibers: pending[f] = <<>>

(* Once every push is delivered, the iPhone has a Live Activity exactly while the engine runs one. *)
ActivityWhileRunning == Quiet => ((phoneLive > 0) = running)

(* ... and it shows the engine's latest change, not an older one. *)
LatestShown == (Quiet /\ running) => phoneVersion = version

(* Never two Live Activities of the same key on the iPhone. *)
OneActivity == phoneLive <= 1

TypeOK ==
    /\ running \in BOOLEAN
    /\ shown \in BOOLEAN
    /\ phoneLive \in 0..MaxRuns
    /\ lock \in Fibers \cup {"none"}
=============================================================================
