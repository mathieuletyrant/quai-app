import ActivityKit
import Foundation

/// The push token of every Quai Live Activity, reported to the server as soon as iOS gives it.
/// Watched from launch, not from a screen: when a push starts a Live Activity, iOS runs the app in
/// the background just long enough to hand over its token, and builds no window. Until the server
/// has the token, the activity's updates and end can't reach this iPhone.
enum ActivityTokens {
    static func watch() {
        Task {
            for activity in Activity<QuaiActivityAttributes>.activities {
                follow(activity)
            }
            for await activity in Activity<QuaiActivityAttributes>.activityUpdates {
                follow(activity)
            }
        }
    }

    private static func follow(_ activity: Activity<QuaiActivityAttributes>) {
        let key = activity.attributes.key
        Task {
            for await data in activity.pushTokenUpdates {
                await report(data.hexString, for: key)
            }
        }
    }

    private static func report(_ token: String, for key: String) async {
        await BackgroundCall.send { client in
            _ = try await client.reportActivityToken(body: .json(.init(mediaKey: key, pushToken: token))).noContent
        }
    }
}
