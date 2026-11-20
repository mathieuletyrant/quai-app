import Foundation

/// The Play/Pause taps the server hasn't confirmed yet. Quai reads Jellyfin every few seconds, so
/// the activities read right after a tap still carry the old state: until the server says the
/// same, or a few seconds pass, the app shows what was asked.
struct PendingPlayback {
    private var shown: [String: (content: Components.Schemas.ActivityContent, until: Date)] = [:]

    /// How long a tap wins over what the server says.
    static let hold: TimeInterval = 8

    /// A Play/Pause tap on `activity`, as shown now.
    mutating func toggle(_ activity: RunningActivity, now: Date = .now) {
        shown[activity.attributes.key] = (Self.toggled(activity.content, now: now), now.addingTimeInterval(Self.hold))
    }

    /// The activities as the app shows them: the server's, with the taps it hasn't caught up with.
    /// A tap the server agrees with, or one held long enough, is forgotten.
    mutating func apply(to activities: [RunningActivity], now: Date = .now) -> [RunningActivity] {
        shown = shown.filter { key, pending in
            guard pending.until > now, let activity = activities.first(where: { $0.attributes.key == key }) else { return false }
            return (activity.content.paused ?? false) != (pending.content.paused ?? false)
        }
        return activities.map { activity in
            guard let pending = shown[activity.attributes.key] else { return activity }
            var tapped = activity
            tapped.content = pending.content
            return tapped
        }
    }

    /// Paused: the position freezes where it is. Resumed: the timeline moves on from there.
    static func toggled(_ content: Components.Schemas.ActivityContent, now: Date) -> Components.Schemas.ActivityContent {
        var next = content
        let at = now.timeIntervalSince1970
        if content.paused == true {
            if let progress = content.progress, let start = content.startsAt, let end = content.endsAt, end > start {
                let length = end - start
                next.startsAt = at - progress * length
                next.endsAt = at + (1 - progress) * length
            }
            next.paused = false
        } else {
            if let start = content.startsAt, let end = content.endsAt, end > start {
                next.progress = min(max((at - start) / (end - start), 0), 1)
            }
            next.paused = true
        }
        return next
    }
}
