import SwiftUI

/// The Activity tab: every running activity, as its Live Activity tells it.
struct ActivityListView: View {
    @Environment(Connection.self) private var connection

    private var eyebrow: String {
        connection.activities.isEmpty ? "Nothing live" : "\(connection.activities.count) live"
    }

    var body: some View {
        NavigationStack {
            Screen {
                TabHeader(eyebrow: eyebrow, title: "Activity")
            } content: {
                if let error = connection.lastError {
                    MessageTile(title: "Can't refresh", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if connection.activities.isEmpty {
                    if connection.lastError == nil {
                        MessageTile(
                            title: "Nothing in progress",
                            message: "Add a movie in Seerr or Radarr: it shows up here and on the Lock Screen.",
                            systemImage: "tray",
                            color: Palette.accent
                        )
                    }
                } else {
                    ForEach(connection.activities, id: \.attributes.key) { activity in
                        ActivityRow(activity: activity)
                    }
                }
                JournalSection()
            }
            .refreshable {
                await connection.refresh()
                await connection.loadJournal()
            }
            .task { await connection.loadJournal() }
        }
    }
}

/// One activity: its flow's symbol and color, the step it's on, its progress or countdown.
struct ActivityRow: View {
    let activity: RunningActivity

    private var details: String {
        var parts = [activity.stepLabel]
        if let remaining = activity.content.remainingSeconds { parts.append(Format.remaining(remaining)) }
        if let speed = activity.content.bytesPerSecond, speed > 0 { parts.append(Format.speed(speed)) }
        if let detail = activity.content.detail { parts.append(detail) }
        if activity.content.tone == .stalled { parts.append("stalled") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        Tile {
            HStack(spacing: 10) {
                Image(systemName: activity.attributes.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(activity.tint)
                    .frame(width: 30, height: 30)
                    .background(activity.tint.opacity(0.18), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(activity.attributes.title)
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let progress = activity.content.progress, activity.content.endsAt == nil {
                    Text(Format.percent(progress))
                        .font(.system(size: 17, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(activity.tint)
                } else if activity.content.endsAt != nil || activity.content.paused != nil {
                    PlaybackClock(content: activity.content)
                }
            }
            if let progress = activity.content.progress {
                ProgressBar(value: progress, color: activity.tint)
            }
            StepTrack(activity: activity)
            Text(details)
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
        }
    }
}

/// The flow's steps as short segments, lit up to the current one (as on the Lock Screen).
private struct StepTrack: View {
    let activity: RunningActivity

    var body: some View {
        let steps = activity.attributes.steps
        if steps.count > 1 {
            HStack(spacing: 4) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, _ in
                    Capsule()
                        .fill(index <= activity.content.step ? activity.tint : Palette.barTrack)
                        .frame(height: 3)
                }
            }
            .accessibilityHidden(true)
        }
    }
}

/// What Quai saw happen, newest first, a page at a time: the history of the titles, the requests and the server.
private struct JournalSection: View {
    @Environment(Connection.self) private var connection
    @State private var loadingOlder = false

    var body: some View {
        if let error = connection.journalError {
            MessageTile(title: "Can't load the history", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
        }
        if !connection.journal.isEmpty {
            SectionHeader(title: "History")
                .padding(.top, 8)
            Card(spacing: 12) {
                ForEach(connection.journal, id: \.id) { entry in
                    JournalRow(entry: entry)
                }
                if connection.journalHasMore {
                    Button {
                        Task {
                            loadingOlder = true
                            await connection.loadOlderJournal()
                            loadingOlder = false
                        }
                    } label: {
                        Text(loadingOlder ? "Loading…" : "Show older")
                            .font(QuaiFont.bodyEmphasized)
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(loadingOlder)
                }
            }
        }
    }
}
