import ActivityKit
import Foundation

/// "Quai Demo" scheme: starts a local Live Activity to iterate on the UI without a server.
enum DemoActivity {
    static func startIfRequested() {
        guard ProcessInfo.processInfo.environment["QUAI_DEMO_ACTIVITY"] == "download" else { return }
        let attributes = DownloadActivityAttributes(mediaKey: "tmdb:438631", title: "Dune")
        let state = DownloadActivityAttributes.ContentState(
            step: .downloading, progress: 0.42, bytesPerSecond: 8_400_000, remainingSeconds: 540, stalled: false)
        _ = try? Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil))
    }
}
