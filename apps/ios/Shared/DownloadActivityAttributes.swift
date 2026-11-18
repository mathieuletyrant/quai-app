import ActivityKit
import Foundation

/// Live Activity « Téléchargement ». Le serveur pousse `ContentState` via APNs (push-to-start puis update).
/// Les noms de champs doivent rester alignés avec le payload envoyé par apps/server.
struct DownloadActivityAttributes: ActivityAttributes {
    enum Step: String, Codable, Hashable, CaseIterable {
        case searching, downloading, importing, subtitles, available
    }

    struct ContentState: Codable, Hashable {
        var step: Step
        var progress: Double?        // 0...1 pendant le téléchargement
        var bytesPerSecond: Int?
        var remainingSeconds: Int?
        var stalled: Bool            // sans source depuis 2 h
    }

    /// Clé d'unicité : TMDB pour un film, TVDB pour une série.
    var mediaKey: String
    var title: String
}
