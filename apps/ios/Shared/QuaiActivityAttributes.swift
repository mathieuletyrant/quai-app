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

    /// Whether the activity draws its row of steps. Not for a flow with buttons (a request: To
    /// approve, Approved): the buttons already say where it stands. Not for a one-step flow either.
    var showsSteps: Bool {
        steps.count > 1 && !steps.contains { !($0.actions ?? []).isEmpty }
    }

    enum Tone: String, Codable, Hashable {
        case active, stalled, done
    }

    /// One line of a step showing a list (today's releases).
    struct Item: Codable, Hashable {
        /// "Severance S02E03"
        var title: String
        /// Epoch seconds it airs at, when known.
        var at: Double?
        /// "waiting", "active" or "done"; a string so an unknown state never breaks the activity.
        var state: String

        var isDone: Bool { state == "done" }
        var isActive: Bool { state == "active" }
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
        /// At most 4 lines, for a step that shows a list.
        var items: [Item]?
        /// With `items`: how many of the whole list are done, out of how many (the lines may be
        /// cut). Optional, so a push without them still decodes.
        var here: Int?
        var total: Int?
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
