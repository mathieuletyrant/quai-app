import ActivityKit
import Foundation

/// The one Live Activity type for every flow (docs/flows.md, What the iPhone receives). The
/// server describes it entirely, so a new flow never needs an app update.
/// Field names must match `ActivityAttributes` / `ActivityContent` in packages/api.
struct QuaiActivityAttributes: ActivityAttributes {
    struct Step: Codable, Hashable {
        var id: String
        var label: String
        /// SF Symbol name.
        var icon: String
        /// Buttons this step offers (`ActivityAction` raw values).
        var actions: [String]?
    }

    enum Tone: String, Codable, Hashable {
        case active, stalled, done
    }

    struct ContentState: Codable, Hashable {
        /// Index into `steps`.
        var step: Int
        var tone: Tone
        var progress: Double?
        var bytesPerSecond: Double?
        var remainingSeconds: Double?
        /// Epoch seconds a countdown runs to.
        var endsAt: Double?
        /// Epoch seconds the timeline began: with `endsAt`, the bar animates without pushes.
        var startsAt: Double?
        /// Playback paused: the bar holds at `progress`, the button shows Play.
        var paused: Bool?
        /// Epoch seconds the step began, for "time since".
        var since: Double?
        var detail: String?
    }

    var key: String
    var flowId: String
    var title: String
    /// Hex, "#FFC230".
    var color: String
    var icon: String
    /// Only the steps this iPhone shows.
    var steps: [Step]
}
