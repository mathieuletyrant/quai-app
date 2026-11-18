import type { DownloadAttributes, DownloadContentState } from "@quai/api"
import type { Push } from "../engine/DownloadEngine.ts"

/** Must match the Swift type name of the attributes: iOS uses it to start the right activity. */
export const attributesType = "DownloadActivityAttributes"

const seconds = (ms: number) => Math.floor(ms / 1000)

const alertFor = (attributes: DownloadAttributes, content: DownloadContentState) => ({
  title: attributes.title,
  body: content.step === "searching"
    ? "Searching for a release"
    : content.step === "downloading"
    ? "Downloading"
    : content.step === "importing"
    ? "Importing"
    : "Ready to watch"
})

/**
 * The APNs body of a Live Activity push. Start goes to a push-to-start token, update and end to
 * the activity's own token. https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
 */
export const apnsBody = (push: Push, now: number): object => {
  const timestamp = seconds(now)
  switch (push._tag) {
    case "Start":
      return {
        aps: {
          timestamp,
          event: "start",
          "content-state": push.content,
          "attributes-type": attributesType,
          attributes: push.attributes,
          alert: alertFor(push.attributes, push.content)
        }
      }
    case "Update":
      return { aps: { timestamp, event: "update", "content-state": push.content } }
    case "End":
      return {
        aps: {
          timestamp,
          event: "end",
          "content-state": push.content,
          "dismissal-date": seconds(push.dismissAt)
        }
      }
  }
}
