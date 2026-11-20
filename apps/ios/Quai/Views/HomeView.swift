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
            case .request, .day:
                // Requests and today's releases have their own tiles, read when the screen opens.
                break
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

    private var tonight: Tonight { Tonight(connection.activities, subjects: connection.flowSubjects) }

    var body: some View {
        NavigationStack {
            Screen {
                TabHeader(eyebrow: Date.now.eyebrow, title: Date.now.partOfDay)
            } content: {
                if let error = connection.lastError {
                    MessageTile(title: "Can't refresh", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let fixes = connection.fixes?.items, !fixes.isEmpty {
                    NavigationLink { FixesView() } label: { FixesTile(fixes: fixes) }
                        .buttonStyle(.plain)
                }
                if let requests = connection.requests?.items, !requests.isEmpty {
                    NavigationLink { RequestsView() } label: { PendingRequestsTile(requests: requests) }
                        .buttonStyle(.plain)
                }
                if let releases = connection.releases?.items, !releases.isEmpty {
                    NavigationLink { ReleasesView() } label: { TodayReleasesTile(releases: releases) }
                        .buttonStyle(.plain)
                }
                tiles(tonight)
            }
            .refreshable {
                await connection.refresh()
                await connection.loadFixes()
                await connection.loadRequests()
                await connection.loadReleases()
            }
            // The To fix list asks Radarr, Sonarr and Reclaimerr: read when the screen opens, not polled.
            .task { await connection.loadFixes() }
            .task { await connection.loadRequests() }
            .task { await connection.loadReleases() }
            .task {
                // Light polling while the screen is open; the Live Activities themselves are pushed.
                while !Task.isCancelled {
                    await connection.refresh()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    @ViewBuilder private func tiles(_ tonight: Tonight) -> some View {
        if tonight.isEmpty {
            if connection.lastError == nil {
                MessageTile(
                    title: "All quiet",
                    message: "Nothing downloading or playing right now.",
                    systemImage: "moon.stars.fill",
                    color: Palette.accent
                )
            }
        } else {
            if let first = tonight.downloading.first {
                openActivity { DownloadsTile(top: first, others: tonight.downloading.count - 1) }
            }
            if !tonight.requested.isEmpty {
                openActivity { OnTheirWayTile(activities: tonight.requested) }
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

/// Today's releases: each with its time and where it stands. Hidden when nothing comes out today.
private struct TodayReleasesTile: View {
    let releases: [DayRelease]

    private var here: Int { releases.filter { $0.status == .available }.count }

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: "Today", systemImage: "calendar", color: Palette.releases)
                Spacer(minLength: 8)
                Text("\(here) of \(releases.count) here")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(releases.prefix(4), id: \.id) { release in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(release.airTime)
                            .font(QuaiFont.caption.monospacedDigit())
                            .foregroundStyle(Palette.secondaryText)
                            .frame(width: 44, alignment: .leading)
                        Text(release.headline)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        ReleaseStatusLabel(status: release.status)
                    }
                }
                if releases.count > 4 {
                    Text("and \(releases.count - 4) more")
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .padding(.leading, 54)
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens today's releases")
    }
}

/// Seerr's requests waiting for approval: the count, and the first ones with their posters.
private struct PendingRequestsTile: View {
    let requests: [Components.Schemas.MediaRequest]

    /// "Asked by Julie" when one person asked for them all.
    private var title: String {
        let people = Set(requests.map(\.requester))
        return people.count == 1 ? "Asked by \(requests[0].requester)" : "Requests"
    }

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: title, systemImage: "person.fill.questionmark", color: Palette.requests)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(requests.count, format: .number)
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(Palette.requests)
                Text("to approve")
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(requests.prefix(3), id: \.id) { request in
                    HStack(spacing: 10) {
                        RequestPoster(request: request, width: 24)
                        Text(request.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(request.kind == .movie ? "movie" : "series")
                            .font(QuaiFont.eyebrow)
                            .foregroundStyle(Palette.requests)
                    }
                }
                if requests.count > 3 {
                    Text("and \(requests.count - 3) more")
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .padding(.leading, 34)
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the requests to approve")
    }
}

/// What needs a tap: the count, and the first problems with their posters.
private struct FixesTile: View {
    let fixes: [Fix]

    var body: some View {
        Tile {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(fixes.count, format: .number)
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(Palette.toFix)
                Text("to fix")
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(fixes.prefix(3)) { fix in
                    HStack(spacing: 10) {
                        FixPoster(fix: fix, width: 24, fallbackSize: 24)
                            .frame(width: 24, height: 36)
                        Text(fix.headline)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(1)
                    }
                }
                if fixes.count > 3 {
                    Text("and \(fixes.count - 3) more")
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .padding(.leading, 34)
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
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

private struct OnTheirWayTile: View {
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
