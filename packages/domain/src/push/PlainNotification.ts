import { Effect } from "effect"
import type { AlertRecipient, Devices } from "../home/Devices.ts"
import type { Journal } from "../journal/Journal.ts"
import type { Apns, ApnsError } from "./Apns.ts"

/** A plain notification: an alert starting or over, something gone. */
export interface Plain {
  readonly title: string
  readonly body?: string | undefined
  /** iOS groups the notifications of one thread: `diskLow`, `gone.plannedDeletion`. */
  readonly thread: string
}

/**
 * Sends a plain notification (APNs `alert` push) to each recipient. Never fails: a refusal is a
 * journal line, and a token Apple says is gone is forgotten.
 */
export const sendPlain = (
  services: {
    readonly apns: Apns["Service"]
    readonly devices: Devices["Service"]
    readonly journal: Journal["Service"]
  },
  recipients: ReadonlyArray<AlertRecipient>,
  notification: Plain
): Effect.Effect<void> =>
  Effect.forEach(recipients, (recipient) =>
    services.apns.send({
      pushType: "alert",
      environment: recipient.apnsEnvironment,
      deviceToken: recipient.token,
      priority: 10,
      body: {
        aps: {
          alert: notification.body === undefined
            ? { title: notification.title }
            : { title: notification.title, body: notification.body },
          sound: "default",
          "thread-id": notification.thread
        }
      }
    }).pipe(
      Effect.catchTag("ApnsError", (error: ApnsError) =>
        Effect.andThen(
          services.journal.log({
            level: "error",
            source: "apple",
            kind: "push.refused",
            text: `Apple refused the notification for ${recipient.name}: ${error.reason}`,
            deviceName: recipient.name
          }),
          error.tokenGone ? services.devices.dropToken(recipient.token).pipe(Effect.ignore) : Effect.void
        ))
    ), { discard: true })
