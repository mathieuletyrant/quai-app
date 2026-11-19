import SwiftUI

typealias RunningActivity = Components.Schemas.RunningActivity

/// What's going on tonight, from the running activities, grouped the way the Home tiles show them.
struct Tonight {
    var downloading: [RunningActivity] = []
    /// Titles on their way: searched for, or importing.
    var requested: [RunningActivity] = []
    /// Titles that reached their last step: ready to watch.
    var ready: [RunningActivity] = []
    var playing: [RunningActivity] = []
    var incidents: [RunningActivity] = []

    var isEmpty: Bool {
        downloading.isEmpty && requested.isEmpty && ready.isEmpty && playing.isEmpty && incidents.isEmpty
    }

    /// `subjects`: what each flow follows, by flow id; a flow left out is read as media.
    init(_ activities: [RunningActivity], subjects: [String: Components.Schemas.FlowSubject]) {
        for activity in activities {
            let done = activity.content.tone == .done
            switch subjects[activity.attributes.flowId] ?? .media {
            case .playback:
                if !done { playing.append(activity) }
            case .service:
                if !done { incidents.append(activity) }
            case .media:
                if done {
                    ready.append(activity)
                } else if activity.content.progress != nil {
                    downloading.append(activity)
                } else {
                    requested.append(activity)
                }
            }
        }
        downloading.sort { ($0.content.progress ?? 0) > ($1.content.progress ?? 0) }
    }
}

extension RunningActivity {
    var stepLabel: String {
        let steps = attributes.steps
        return steps.indices.contains(content.step) ? steps[content.step].label : ""
    }

    var tint: Color { Palette.tint(tone: content.tone.rawValue, color: attributes.color) }
}

/// The Home tab: tonight's downloads, requests, playback and incidents, as tiles.
struct HomeView: View {
    @Environment(Connection.self) private var connection
    @Binding var tab: AppTab
    @State private var showSettings = false

    private var tonight: Tonight { Tonight(connection.activities, subjects: connection.flowSubjects) }

    var body: some View {
        NavigationStack {
            Screen {
                ScreenHeader(eyebrow: Date.now.eyebrow, title: "Tonight") {
                    GlassIconButton(systemImage: "gearshape", label: "Settings") { showSettings = true }
                }
            } content: {
                if let error = connection.lastError {
                    MessageTile(title: "Can't refresh", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let fixes = connection.fixes?.items, !fixes.isEmpty {
                    NavigationLink { FixesView() } label: { FixesTile(fixes: fixes) }
                        .buttonStyle(.plain)
                }
                tiles(tonight)
            }
            .refreshable {
                await connection.refresh()
                await connection.loadFixes()
            }
            // The To fix list asks Radarr, Sonarr and Reclaimerr: read when the screen opens, not polled.
            .task { await connection.loadFixes() }
            .task {
                // Light polling while the screen is open; the Live Activities themselves are pushed.
                while !Task.isCancelled {
                    await connection.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    @ViewBuilder private func tiles(_ tonight: Tonight) -> some View {
        if tonight.isEmpty {
            if connection.lastError == nil {
                MessageTile(
                    title: "All quiet",
                    message: "Nothing is downloading or playing. Add a movie in Seerr or Radarr: it shows up here and on the Lock Screen.",
                    systemImage: "moon.stars.fill",
                    color: Palette.accent
                )
            }
        } else {
            if let first = tonight.downloading.first {
                openActivity { DownloadsTile(top: first, others: tonight.downloading.count - 1) }
            }
            if !tonight.requested.isEmpty {
                openActivity { RequestsTile(activities: tonight.requested) }
            }
            HStack(alignment: .top, spacing: Metrics.tileSpacing) {
                openActivity {
                    CountTile(
                        title: "Ready", systemImage: "checkmark.circle.fill", color: Palette.releases,
                        count: tonight.ready.count,
                        caption: tonight.ready.isEmpty ? "nothing new yet" : (tonight.ready.count == 1 ? "title to watch" : "titles to watch")
                    )
                }
                openActivity {
                    CountTile(
                        title: "Incidents", systemImage: "exclamationmark.triangle.fill",
                        color: tonight.incidents.isEmpty ? Palette.ok : Palette.incident,
                        count: tonight.incidents.count,
                        caption: tonight.incidents.isEmpty ? "all services up" : tonight.incidents.map(\.attributes.title).joined(separator: ", ")
                    )
                }
            }
            if !tonight.playing.isEmpty {
                openActivity { PlayingTile(activities: tonight.playing) }
            }
        }
    }

    /// A tile that opens the Activity tab.
    private func openActivity<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let tile = content()
        return Button { tab = .activity } label: { tile }
            .buttonStyle(.plain)
    }
}

/// What needs a tap: the count, and the first problems.
private struct FixesTile: View {
    let fixes: [Fix]

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: "To fix", systemImage: "wrench.and.screwdriver.fill", color: Palette.toFix)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(fixes.count, format: .number)
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(Palette.toFix)
                Text(fixes.count == 1 ? "point to settle" : "points to settle")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
            ForEach(fixes.prefix(2)) { fix in
                HStack(spacing: 8) {
                    Image(systemName: fix.symbol.name)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(fix.symbol.color)
                        .frame(width: 16)
                    Text(fix.headline)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.primaryText)
                        .lineLimit(1)
                }
            }
            if fixes.count > 2 {
                Text("and \(fixes.count - 2) more").font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the To fix list")
    }
}

private struct DownloadsTile: View {
    let top: RunningActivity
    let others: Int

    private var details: String {
        var parts: [String] = []
        if let remaining = top.content.remainingSeconds { parts.append(Format.remaining(remaining)) }
        if let speed = top.content.bytesPerSecond, speed > 0 { parts.append(Format.speed(speed)) }
        if others > 0 { parts.append(others == 1 ? "1 more download" : "\(others) more downloads") }
        return parts.isEmpty ? top.stepLabel : parts.joined(separator: " · ")
    }

    var body: some View {
        Tile {
            TileLabel(title: "Downloads", systemImage: "arrow.down", color: Palette.downloads)
            HStack(alignment: .firstTextBaseline) {
                Text(top.attributes.title).font(QuaiFont.headline).lineLimit(1)
                Spacer(minLength: 8)
                if let progress = top.content.progress {
                    Text(Format.percent(progress))
                        .font(.system(size: 17, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.downloads)
                }
            }
            .foregroundStyle(Palette.primaryText)
            ProgressBar(value: top.content.progress ?? 0, color: top.content.tone == .stalled ? Palette.stalled : Palette.downloads)
            Text(details).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
        }
    }
}

private struct RequestsTile: View {
    let activities: [RunningActivity]

    var body: some View {
        Tile {
            TileLabel(title: activities.count == 1 ? "On its way" : "On their way", systemImage: "person.fill", color: Palette.requests)
            ForEach(activities.prefix(3), id: \.attributes.key) { activity in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(activity.attributes.title)
                        .font(QuaiFont.headline)
                        .foregroundStyle(Palette.primaryText)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(activity.stepLabel.lowercased())
                        .font(QuaiFont.eyebrow)
                        .foregroundStyle(activity.content.tone == .stalled ? Palette.stalled : Palette.requests)
                }
            }
            if activities.count > 3 {
                Text("and \(activities.count - 3) more").font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
            }
        }
    }
}

private struct CountTile: View {
    let title: String
    let systemImage: String
    let color: Color
    let count: Int
    let caption: String

    var body: some View {
        Tile {
            TileLabel(title: title, systemImage: systemImage, color: color)
            Text(count, format: .number)
                .font(QuaiFont.value)
                .monospacedDigit()
                .foregroundStyle(Palette.primaryText)
            Text(caption)
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
                .lineLimit(2)
        }
    }
}

private struct PlayingTile: View {
    let activities: [RunningActivity]

    var body: some View {
        Tile {
            TileLabel(title: "Playing", systemImage: "play.fill", color: Palette.playback)
            ForEach(activities, id: \.attributes.key) { activity in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(activity.attributes.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(1)
                        if let detail = activity.content.detail, !detail.isEmpty {
                            Text(detail).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
                        }
                    }
                    Spacer(minLength: 8)
                    PlaybackClock(content: activity.content)
                }
            }
        }
    }
}

/// "Paused", or the time left, counting down on its own.
struct PlaybackClock: View {
    let content: Components.Schemas.ActivityContent

    var body: some View {
        Group {
            if content.paused == true {
                Text("Paused")
            } else if let endsAt = content.endsAt, endsAt > Date.now.timeIntervalSince1970 {
                Text(timerInterval: Date.now...Date(timeIntervalSince1970: endsAt), countsDown: true)
                    .monospacedDigit()
            }
        }
        .font(QuaiFont.eyebrow)
        .foregroundStyle(Palette.playback)
    }
}
