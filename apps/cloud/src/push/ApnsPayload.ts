import type { ActivityAttributes, ActivityContent } from "@quai/api"
import type { Delivery } from "../flows/Targeting.ts"

/** Must match the Swift type name of the attributes: iOS uses it to start the right activity. */
export const attributesType = "QuaiActivityAttributes"

const seconds = (ms: number) => Math.floor(ms / 1000)

const alertFor = (attributes: ActivityAttributes, content: ActivityContent) => ({
  title: attributes.title,
  body: attributes.steps[content.step]?.label ?? ""
})

/**
 * The APNs body of a Live Activity push. Start goes to a push-to-start token, update and end to
 * the activity's own token. https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
 */
export const apnsBody = (delivery: Exclude<Delivery, { _tag: "None" }>, now: number): object => {
  const timestamp = seconds(now)
  switch (delivery._tag) {
    case "Start":
      return {
        aps: {
          timestamp,
          event: "start",
          "content-state": delivery.content,
          "attributes-type": attributesType,
          attributes: delivery.attributes,
          alert: alertFor(delivery.attributes, delivery.content)
        }
      }
    case "Update":
      return { aps: { timestamp, event: "update", "content-state": delivery.content } }
    case "End":
      return {
        aps: { timestamp, event: "end", "content-state": delivery.content, "dismissal-date": seconds(delivery.dismissAt) }
      }
  }
}
