import ActivityKit
import Foundation

/// "Quai Demo" scheme: starts a local Live Activity to iterate on the UI without a server.
enum DemoActivity {
    static func startIfRequested() {
        guard ProcessInfo.processInfo.environment["QUAI_DEMO_ACTIVITY"] != nil else { return }
        let attributes = QuaiActivityAttributes(
            key: "demo|movie:tmdb:438631",
            flowId: "download",
            title: "Dune",
            color: "#FFC230",
            icon: "arrow.down",
            steps: [
                .init(id: "searching", label: "Searching", icon: "magnifyingglass"),
                .init(id: "downloading", label: "Downloading", icon: "arrow.down"),
                .init(id: "importing", label: "Importing", icon: "tray.and.arrow.down.fill"),
                .init(id: "available", label: "Ready to watch", icon: "checkmark"),
            ]
        )
        let state = QuaiActivityAttributes.ContentState(
            step: 1, tone: .active, progress: 0.42, bytesPerSecond: 8_400_000, remainingSeconds: 540
        )
        _ = try? Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil))
    }
}
