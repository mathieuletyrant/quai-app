import ActivityKit
import AppIntents
import Foundation

/// The buttons a Live Activity step can offer. Raw values match `ActionType` in packages/api.
enum ActivityAction: String, CaseIterable {
    case playPause = "playback.playPause"
    case stop = "playback.stop"

    func symbol(paused: Bool) -> String {
        switch self {
        case .playPause: paused ? "play.fill" : "pause.fill"
        case .stop: "stop.fill"
        }
    }

    var label: String {
        switch self {
        case .playPause: "Play or pause"
        case .stop: "Stop"
        }
    }
}

/// A button tapped on a Live Activity. iOS runs it in the app's process (waking it in the
/// background if needed), which forwards it to the Quai server; the widget only declares it.
struct ActivityActionIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Control a Quai activity"
    static let isDiscoverable = false

    @Parameter(title: "Activity") var key: String
    @Parameter(title: "Action") var action: String

    init() {}

    init(key: String, action: ActivityAction) {
        self.key = key
        self.action = action.rawValue
    }

    func perform() async throws -> some IntentResult {
        #if !WIDGET_EXTENSION
            if let action = ActivityAction(rawValue: action) {
                try await RemoteControl.perform(key: key, action: action)
            }
        #endif
        return .result()
    }
}
