import UIKit
import UserNotifications

/// Alerts arrive as plain notifications: the app asks once, registers with APNs, and hands the
/// device token to the server, which sends them.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Every device token APNs gives this app, as hex.
    static let tokens = AsyncStream<String>.makeStream()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Self.tokens.continuation.yield(deviceToken.hexString)
    }

    /// An alert that comes while the app is open still shows as a banner.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}

enum Notifications {
    /// Asks for notifications (iOS only asks once), then registers with APNs when they're allowed.
    @MainActor static func register() async {
        let allowed = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        if allowed { UIApplication.shared.registerForRemoteNotifications() }
    }
}
