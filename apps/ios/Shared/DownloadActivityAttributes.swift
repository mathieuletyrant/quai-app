import ActivityKit
import Foundation

/// "Download" Live Activity. The server pushes `ContentState` over APNs (push-to-start, then updates).
/// Field names must match the payload apps/server sends.
struct DownloadActivityAttributes: ActivityAttributes {
    enum Step: String, Codable, Hashable, CaseIterable {
        case searching, downloading, importing, subtitles, available
    }

    struct ContentState: Codable, Hashable {
        var step: Step
        var progress: Double?        // 0...1 while downloading
        var bytesPerSecond: Int?
        var remainingSeconds: Int?
        var stalled: Bool            // no source for 2 h
    }

    /// Uniqueness key: TMDB for a movie, TVDB for a series.
    var mediaKey: String
    var title: String
}
