import SwiftUI

typealias RunningActivity = Components.Schemas.RunningActivity

/// What's going on today, from the running activities, grouped the way the Home tiles show them.
struct Today {
    var downloading: [RunningActivity] = []
    /// Titles on their way: searched for, or importing.
    var requested: [RunningActivity] = []
    /// Titles that reached their last step: ready to watch.
    var ready: [RunningActivity] = []
    var playing: [RunningActivity] = []

    var isEmpty: Bool {
        downloading.isEmpty && requested.isEmpty && ready.isEmpty && playing.isEmpty
    }

    /// `subjects`: what each flow follows, by flow id; a flow left out is read as media.
    init(_ activities: [RunningActivity], subjects: [String: Components.Schemas.FlowSubject]) {
        for activity in activities {
            let done = activity.content.tone == .done
            switch subjects[activity.attributes.flowId] ?? .media {
            case .playback:
                if !done { playing.append(activity) }
            case .request, .day:
                // Requests and Upcoming have their own tiles, read when the screen opens.
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

/// The Home tab: what needs you (to fix, to approve), what comes out today, the alerts and the
/// disk. What plays and what's on its way (searched, downloading, importing) is in the live bar,
/// over the tabs.
struct HomeView: View {
    @Environment(Connection.self) private var connection
    @Binding var tab: AppTab
    @Binding var libraryFilter: LibraryFilter
    /// The spinner beside the title: a search for the server that takes more than a moment.
    @State private var showsSearching = false

    private var highlights: LibraryHighlights? { connection.library.map { LibraryHighlights($0.items) } }
    private var today: Today { Today(connection.activities, subjects: connection.flowSubjects) }
    private var alerts: [Components.Schemas.ActiveAlert] { connection.alerts?.items ?? [] }
    private var fixes: [Fix] { connection.fixes?.items ?? [] }
    private var requests: [Components.Schemas.MediaRequest] { connection.requests?.items ?? [] }
    private var upcoming: Components.Schemas.Upcoming? { connection.upcoming }
    /// What's out or going today: the Home isn't quiet while there's some.
    private var upcomingToday: [UpcomingItem] {
        guard let upcoming else { return [] }
        let schedule = UpcomingSchedule(timeZone: upcoming.timeZone)
        return upcoming.items.filter { schedule.period($0) == .today }
    }
    private var diskIsLow: Bool { alerts.contains { $0.kind == .diskLow } }

    private var serverMark: ServerMark? {
        ServerMark.of(status: connection.status, searching: showsSearching, error: connection.lastError)
    }

    /// Nothing asks for a look: the Home says so instead of showing empty tiles.
    private var isQuiet: Bool {
        fixes.isEmpty && requests.isEmpty && upcomingToday.isEmpty && alerts.isEmpty
    }

    /// The first reads haven't answered yet (a failed one counts as answered): the Home shows the
    /// tiles' shapes instead of "All quiet" and tiles popping in one by one.
    private var isLoading: Bool {
        (connection.fixes == nil && connection.fixesError == nil)
            || (connection.requests == nil && connection.requestsError == nil)
            || (connection.upcoming == nil && connection.upcomingError == nil)
    }

    var body: some View {
        NavigationStack {
            Screen {
                TabHeader(eyebrow: Date.now.eyebrow, title: Date.now.partOfDay, mark: serverMark)
            } content: {
                VStack(alignment: .leading, spacing: Metrics.tileSpacing) {
                    if isLoading {
                        HomeSkeleton(showsStorage: connection.library == nil)
                            .transition(.opacity)
                    } else {
                        tiles
                            .transition(.opacity)
                    }
                }
                .animation(.smooth(duration: 0.35), value: isLoading)
                .animation(.smooth(duration: 0.35), value: connection.library == nil)
            }
            // At home the server answers at once: the spinner only shows a search that takes a while.
            .task(id: connection.isSearching) {
                guard connection.isSearching else {
                    showsSearching = false
                    return
                }
                try? await Task.sleep(for: .milliseconds(600))
                if !Task.isCancelled { showsSearching = true }
            }
            .refreshable {
                await connection.refresh()
                await connection.loadFixes()
                await connection.loadRequests()
                await connection.loadUpcoming()
                await connection.loadLibrary()
                await connection.loadAlerts()
            }
            // The To fix list asks Radarr, Sonarr, Reclaimerr and Cleanuparr: read when the screen opens, not polled.
            .task { await connection.loadFixes() }
            .task { await connection.loadRequests() }
            .task { await connection.loadUpcoming() }
            // The disk comes with the library; the Library tab keeps it current once open.
            .task {
                guard connection.library == nil else { return }
                await connection.loadLibrary()
            }
            .task {
                // The activities are read app-wide, for the live bar; the alerts while the Home is open.
                while !Task.isCancelled {
                    await connection.loadAlerts()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    /// The tiles once the first reads have answered: each one only when it has something to show.
    @ViewBuilder private var tiles: some View {
        if !fixes.isEmpty {
            NavigationLink { FixesView() } label: { FixesTile(fixes: fixes) }
                .buttonStyle(.plain)
        }
        if !requests.isEmpty {
            NavigationLink { RequestsView() } label: { PendingRequestsTile(requests: requests) }
                .buttonStyle(.plain)
        }
        if let upcoming, !upcoming.items.isEmpty {
            NavigationLink { UpcomingView() } label: { UpcomingTile(upcoming: upcoming) }
                .buttonStyle(.plain)
        }
        if !alerts.isEmpty {
            AlertsTile(alerts: alerts)
        }
        if isQuiet && connection.lastError == nil {
            MessageTile(
                title: "All quiet",
                message: "Nothing to fix, approve or wait for right now.",
                systemImage: "moon.stars.fill",
                color: Palette.accent
            )
        }
        if let highlights, !highlights.isEmpty {
            TileRow {
                openLibrary(.recent) { RecentlyAddedTile(highlights: highlights) }
                openLibrary(.wanted) { WantedTile(count: highlights.wanted) }
            }
        }
        if let disk = connection.library?.disk {
            Button { tab = .library } label: { StorageTile(reading: DiskReading(disk), isLow: diskIsLow) }
                .buttonStyle(.plain)
        }
    }

    /// A tile that opens the Library tab on one of its filters.
    private func openLibrary<Content: View>(_ filter: LibraryFilter, @ViewBuilder _ content: () -> Content) -> some View {
        let tile = content()
        return Button {
            libraryFilter = filter
            tab = .library
        } label: { tile }
            .buttonStyle(.plain)
    }
}

/// The Home while its first reads are on their way: the shapes of the usual tiles, then the disk.
private struct HomeSkeleton: View {
    let showsStorage: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.tileSpacing) {
            SkeletonTile(rows: 3)
            SkeletonTile(rows: 2)
            SkeletonTile(rows: 2, showsValue: false)
            if showsStorage {
                SkeletonStorageTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
        .accessibilityIdentifier("homeLoading")
    }
}

/// What the Home's Library tiles say: the latest titles added, how many this week, how many wanted.
struct LibraryHighlights {
    /// The latest titles added to Radarr or Sonarr, newest first, at most 3.
    let latest: [LibraryItem]
    /// Added in the last 7 days.
    let addedThisWeek: Int
    /// Monitored, out, and still without their file (the Library's Wanted chip).
    let wanted: Int

    var isEmpty: Bool { latest.isEmpty }

    init(_ items: [LibraryItem], now: Date = .now) {
        let added = items.filter { $0.addedAt != nil }.sorted { ($0.addedAt ?? 0) > ($1.addedAt ?? 0) }
        let weekAgo = now.addingTimeInterval(-7 * 24 * 3600).timeIntervalSince1970
        latest = Array(added.prefix(3))
        addedThisWeek = added.filter { ($0.addedAt ?? 0) >= weekAgo }.count
        wanted = items.filter { $0.status == .wanted }.count
    }

    /// "4 this week", or the latest title's caption when none came this week.
    var recentCaption: String {
        if addedThisWeek > 0 { return "\(addedThisWeek) this week" }
        return latest.first?.caption ?? ""
    }

    /// "titles missing", "title missing", "Nothing missing".
    static func wantedCaption(_ wanted: Int) -> String {
        switch wanted {
        case 0: "Nothing missing"
        case 1: "title missing"
        default: "titles missing"
        }
    }
}

/// A square: the three latest posters fanned out, the newest title and how many came this week.
private struct RecentlyAddedTile: View {
    let highlights: LibraryHighlights

    var body: some View {
        SquareTile {
            TileLabel(title: "Recently added", systemImage: "sparkles", color: Palette.accent)
            Spacer(minLength: 8)
            PosterFan(items: highlights.latest)
                .frame(maxWidth: .infinity)
            Spacer(minLength: 8)
            Text(highlights.latest.first?.title ?? "")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.primaryText)
                .lineLimit(1)
            Text(highlights.recentCaption)
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the Library")
    }
}

/// Up to three posters, the newest in front, the others tilted behind it.
private struct PosterFan: View {
    let items: [LibraryItem]

    private struct Layer: Identifiable {
        let item: LibraryItem
        let angle: Double
        let offset: CGFloat
        var id: String { item.id }
    }

    /// Back to front: the oldest first, so the newest is drawn last.
    private var layers: [Layer] {
        let placements: [(angle: Double, offset: CGFloat)] = [(0, 0), (8, 22), (-8, -22)]
        return zip(items, placements).map { Layer(item: $0.0, angle: $0.1.angle, offset: $0.1.offset) }.reversed()
    }

    var body: some View {
        ZStack {
            ForEach(layers) { layer in
                // Only the front poster falls back to its title: behind, it would peek out cut.
                Poster(url: PosterSize.small.url(layer.item.posterUrl), title: layer.angle == 0 ? layer.item.title : "", cornerRadius: 8)
                    .frame(width: 48)
                    .shadow(color: .black.opacity(0.45), radius: 6, y: 3)
                    .rotationEffect(.degrees(layer.angle))
                    .offset(x: layer.offset, y: layer.angle == 0 ? 0 : 4)
            }
        }
        .frame(height: 76)
    }
}

/// A square: how many titles Radarr and Sonarr are still looking for, in large.
private struct WantedTile: View {
    let count: Int

    private var color: Color { count == 0 ? Palette.ok : Palette.wantedText }

    var body: some View {
        SquareTile {
            TileLabel(title: "Wanted", systemImage: "magnifyingglass", color: color)
            Spacer(minLength: 8)
            if count == 0 {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(color)
            } else {
                Text("\(count)")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .tracking(-1)
                    .foregroundStyle(color)
            }
            Text(LibraryHighlights.wantedCaption(count))
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens what's wanted in the Library")
    }
}

/// What's wrong right now, whatever its kind (a service down, the disk low, a problem an *arr
/// reports): one line each, with when it started. Hidden when all is well.
private struct AlertsTile: View {
    let alerts: [Components.Schemas.ActiveAlert]

    var body: some View {
        Tile {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(alerts.count, format: .number)
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(Palette.incident)
                Text(alerts.count == 1 ? "alert" : "alerts")
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
            }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(alerts, id: \.id) { alert in
                    AlertRow(alert: alert)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct AlertRow: View {
    let alert: Components.Schemas.ActiveAlert

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(alert.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.primaryText)
                if let detail = alert.detail {
                    Text(detail)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                }
            }
            Spacer(minLength: 8)
            Text(Date(timeIntervalSince1970: alert.since / 1000), format: .dateTime.hour().minute())
                .font(QuaiFont.caption.monospacedDigit())
                .foregroundStyle(Palette.secondaryText)
                .fixedSize()
        }
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
