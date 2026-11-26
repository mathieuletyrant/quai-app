import type { DiskHolds, GoneKind, HomeOffline } from "@quai/api"
import { Clock, Context, Effect, Layer } from "effect"
import { Devices } from "../home/Devices.ts"
import { Journal } from "../journal/Journal.ts"
import { Apns } from "../push/Apns.ts"
import { sendPlain } from "../push/PlainNotification.ts"

/**
 * Something gone (GLOSSARY): what Upcoming showed as going, done by the stack on its own. An
 * integration's reading, as an alert's state is: the integration logs what happened, Gone notifies.
 */
export interface GoneItem {
  readonly _tag: "Gone"
  readonly kind: GoneKind
  readonly source: "reclaimerr" | "cleanuparr"
  /** When the service did it, epoch milliseconds. */
  readonly at: number
  /** As the service names it: "Vampire Diaries S07", a release name. */
  readonly title: string
  /** Who did what, and the space back when sure: "Deleted by Reclaimerr · 24 GB back". */
  readonly detail: string
  /** The space surely back, for its disk mark. */
  readonly spaceBack?: number
  /** What it was, when the service says: the disks holding it get its mark, else every media disk. */
  readonly holds?: DiskHolds
  /** Reclaimerr moved it rather than deleting it. */
  readonly moved?: boolean
}

/** What happened longer ago than this goes to the journal only: a notification would come too late. */
export const freshForMs = 3600_000

export const goneItem = (item: Omit<GoneItem, "_tag">): GoneItem => ({ _tag: "Gone", ...item })

/** "Vampire Diaries S07 is gone". */
export const goneTitle = (item: Pick<GoneItem, "title">) => `${item.title} is gone`

/** Whether it happened recently enough to be notified. */
export const isFresh = (item: Pick<GoneItem, "at">, now: number) => now - item.at <= freshForMs

/** "24 GB", "1.2 TB", "650 MB": decimal units, like the iPhone's. */
export const sizeText = (bytes: number) => {
  const gigabytes = bytes / 1e9
  if (gigabytes >= 1000) return `${(gigabytes / 1000).toFixed(1)} TB`
  if (gigabytes >= 1) return `${Math.round(gigabytes)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** " · 24 GB back" when space surely came back, nothing otherwise. */
export const spaceBackText = (bytes: number | undefined) =>
  bytes === undefined || bytes <= 0 ? "" : ` · ${sizeText(bytes)} back`

/**
 * Gone (docs/adr/0002-gone-is-not-an-alert.md): a notification to the iPhones that turned its kind
 * on, when it is fresh (its journal line is the integration's). Never fails: an offline home or a
 * refused push is logged.
 */
export class Gone extends Context.Service<Gone, {
  readonly notify: (item: GoneItem) => Effect.Effect<void>
  /** The kinds an iPhone turned on: nothing is watched for the others. */
  readonly wanted: Effect.Effect<ReadonlyArray<GoneKind>, HomeOffline>
}>()("quai/Gone") {
  static readonly layer = Layer.effect(
    Gone,
    Effect.gen(function*() {
      const devices = yield* Devices
      const apns = yield* Apns
      const journal = yield* Journal

      const notify = (item: GoneItem) =>
        Effect.gen(function*() {
          if (!isFresh(item, yield* Clock.currentTimeMillis)) return
          const recipients = yield* devices.goneRecipients(item.kind)
          yield* sendPlain({ apns, devices, journal }, recipients, {
            title: goneTitle(item),
            body: item.detail,
            thread: `gone.${item.kind}`
          })
        }).pipe(Effect.catchTag("HomeOffline", (error) => Effect.logWarning(`gone not notified: ${error.message}`)))

      return { notify, wanted: devices.goneWanted }
    })
  )
}
