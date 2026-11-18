import ActivityKit
import Foundation

/// "Download" Live Activity. The server pushes `ContentState` over APNs (push-to-start, then updates).
/// Field names and step values must match `DownloadContentState` in packages/api.
struct DownloadActivityAttributes: ActivityAttributes {
    enum Step: String, Codable, Hashable, CaseIterable {
        case searching, downloading, importing, available
    }

    struct ContentState: Codable, Hashable {
        var step: Step
        /// 0...1, only while downloading.
        var progress: Double?
        var bytesPerSecond: Double?
        var remainingSeconds: Double?
        /// No source for 2 h: shown grey with "Other release".
        var stalled: Bool
    }

    /// Uniqueness key from the server: `movie:tmdb:<id>`, or a series plus its torrent.
    var mediaKey: String
    var title: String
    /// The steps this iPhone chose to see, in order (Settings → Live Activities). Nil: all of them.
    var steps: [Step]?

    var shownSteps: [Step] { steps ?? Step.allCases }
}
