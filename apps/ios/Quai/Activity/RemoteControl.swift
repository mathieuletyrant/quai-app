import ActivityKit
import Foundation

/// Runs a Live Activity button: shows the result on the activity at once, then asks the server,
/// whose push confirms it a second later.
enum RemoteControl {
    static func perform(key: String, action: ActivityAction) async throws {
        await optimisticallyApply(action, to: key)
        // The access headers come with the session: the button works through the proxy too.
        guard let session = ServerSession.stored() else { throw ConnectionError.unreachable }
        let (_, client) = try await session.connect()
        guard let type = Components.Schemas.ActionType(rawValue: action.rawValue) else { return }
        _ = try await client.performAction(body: .json(.init(key: key, action: type))).noContent
    }

    /// Play/Pause flips at once on screen; the server's next push carries the exact position.
    private static func optimisticallyApply(_ action: ActivityAction, to key: String) async {
        guard action == .playPause,
              let activity = Activity<QuaiActivityAttributes>.activities.first(where: { $0.attributes.key == key })
        else { return }
        var state = activity.content.state
        let now = Date.now.timeIntervalSince1970
        if state.paused == true {
            // Resume: shift the timeline so it continues from where it held.
            if let progress = state.progress, let start = state.startsAt, let end = state.endsAt {
                let length = end - start
                state.startsAt = now - progress * length
                state.endsAt = now + (1 - progress) * length
            }
            state.paused = false
        } else {
            if let start = state.startsAt, let end = state.endsAt, end > start {
                state.progress = min(max((now - start) / (end - start), 0), 1)
            }
            state.paused = true
        }
        await activity.update(.init(state: state, staleDate: nil))
    }
}
