import SwiftUI

typealias UpcomingItem = Components.Schemas.UpcomingItem

extension Components.Schemas.UpcomingItem: Identifiable {}

extension Components.Schemas.UpcomingItem {
    /// It arrives (a release) rather than goes (a deletion, a removal, a seed cleanup).
    var isComing: Bool { kind == .releaseDay }

    /// The service's color over the title: what comes in the releases' blue, what goes in the To fix orange.
    var tint: Color { isComing ? Palette.releases : Palette.toFix }

    /// "Severance · S02E05", "Dune", "14 torrents"
    var headline: String { episode.map { "\(title) · \($0)" } ?? title }

    /// The symbol a row without a poster shows.
    var symbol: String {
        switch kind {
        case .releaseDay: episode == nil ? "film" : "tv"
        case .plannedDeletion: "trash"
        case .stuckRemoval: "xmark.bin"
        case .seedCleanup: "arrow.up.arrow.down"
        }
    }

    /// A deletion or a stuck removal opens its To fix card.
    var opensFix: Bool { fixId != nil }

    /// After the date: "· +24.49 GB", when the space surely comes back.
    var freedText: String? { freesBytes.map { "· +" + Format.bytes($0) } }

    /// A row opens something: To fix, or the title of a release.
    var opens: Bool { opensFix || libraryId != nil }
}

/// What the screen shows: everything, what arrives, or what goes.
enum UpcomingFilter: Hashable {
    case all, coming, going

    func includes(_ item: UpcomingItem) -> Bool {
        switch self {
        case .all: true
        case .coming: item.isComing
        case .going: !item.isComing
        }
    }
}

/// When a row happens, in words, and which part of the screen it goes in: days counted from
/// today in the home's time zone (the next 7 are this week, the next 30 this month).
struct UpcomingSchedule {
    let now: Date
    let timeZone: TimeZone

    enum Period: Int, CaseIterable, Comparable {
        case today, thisWeek, thisMonth, later, byRatio

        var title: String {
            switch self {
            case .today: "Today"
            case .thisWeek: "This week"
            case .thisMonth: "This month"
            case .later: "Later"
            case .byRatio: "When the ratio is reached"
            }
        }

        static func < (lhs: Period, rhs: Period) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    init(now: Date = .now, timeZone identifier: String) {
        self.now = now
        timeZone = TimeZone(identifier: identifier) ?? .current
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// Days from today to the date's day: 0 today (or already past), 1 tomorrow.
    private func daysAhead(_ date: Date) -> Int {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        return max(0, days)
    }

    func period(_ item: UpcomingItem) -> Period {
        guard let at = item.at else { return .byRatio }
        let days = daysAhead(Date(timeIntervalSince1970: at))
        if days == 0 { return .today }
        if days < 7 { return .thisWeek }
        if days < 30 { return .thisMonth }
        return .later
    }

    /// Today the time ("21:00"), else the day ("Thu Nov 26"), a range on one line ("Thu–Sun, Nov 26–29").
    func when(_ item: UpcomingItem) -> String {
        guard let at = item.at else { return "No date: by ratio" }
        let date = Date(timeIntervalSince1970: at)
        let earliest = item.earliest ? "Earliest " : ""
        // A week of seed cleanups starting today still says its days.
        if let until = item.until.map(Date.init(timeIntervalSince1970:)), !calendar.isDate(date, inSameDayAs: until) {
            return earliest + range(date, until)
        }
        if daysAhead(date) == 0 {
            if item.timed { return earliest + format("HH:mm", date) }
            return item.isComing ? "Out today" : earliest + "Today"
        }
        return earliest + format("EEE MMM d", date)
    }

    /// "Thu–Sun, Nov 26–29"; across months "Mon Nov 30 – Sun Dec 6".
    func range(_ start: Date, _ end: Date) -> String {
        guard calendar.isDate(start, equalTo: end, toGranularity: .month) else {
            return "\(format("EEE MMM d", start)) – \(format("EEE MMM d", end))"
        }
        return "\(format("EEE", start))–\(format("EEE", end)), \(format("MMM d", start))–\(format("d", end))"
    }

    private func format(_ pattern: String, _ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    /// The rows of one part of the screen.
    struct PeriodRows: Identifiable {
        let period: Period
        let items: [UpcomingItem]
        var id: Period { period }
    }

    /// The items by part of the screen, in order, each in date order.
    func periods(_ items: [UpcomingItem]) -> [PeriodRows] {
        Dictionary(grouping: items) { period($0) }
            .sorted { $0.key < $1.key }
            .map { PeriodRows(period: $0.key, items: $0.value) }
    }

    /// What goes in the next 7 days, in a few words: "1 Reclaimerr deletion this week", "3 going this week".
    func goingThisWeek(_ items: [UpcomingItem]) -> String? {
        let going = items.filter { !$0.isComing && [.today, .thisWeek].contains(period($0)) }
        guard !going.isEmpty else { return nil }
        if going.allSatisfy({ $0.kind == .plannedDeletion }) {
            return going.count == 1 ? "1 Reclaimerr deletion this week" : "\(going.count) Reclaimerr deletions this week"
        }
        return "\(going.count) going this week"
    }
}

/// Upcoming: what the stack will do on its own, by date. What comes (Radarr's and Sonarr's
/// releases, 14 days) and what goes (Reclaimerr's deletions, Cleanuparr's removals and seed
/// cleanups), with the space that really comes back. Read only: a deletion or a removal opens To fix.
struct UpcomingView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var filter: UpcomingFilter = .all
    @State private var selected: LibraryItem?

    private var items: [UpcomingItem] { connection.upcoming?.items ?? [] }
    private var shown: [UpcomingItem] { items.filter(filter.includes) }
    private var schedule: UpcomingSchedule { UpcomingSchedule(timeZone: connection.upcoming?.timeZone ?? TimeZone.current.identifier) }
    private var hasGoing: Bool { items.contains { !$0.isComing } }

    private var summary: String? {
        guard connection.upcoming != nil else { return nil }
        let coming = items.filter(\.isComing).count
        let going = items.count - coming
        if items.isEmpty { return "Nothing planned" }
        return "\(coming) coming · \(going) going"
    }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "Upcoming", subtitle: summary)
        } content: {
            if let error = connection.upcomingError {
                MessageTile(title: "Can't load what's coming", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            ForEach(notes, id: \.self) { note in
                Text(note)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
            if hasGoing || filter != .all {
                HStack(spacing: 8) {
                    Chip(title: "All", selected: filter == .all) { filter = .all }
                    Chip(title: "Coming", selected: filter == .coming) { filter = .coming }
                    Chip(title: "Going", selected: filter == .going) { filter = .going }
                }
            }
            if connection.upcoming == nil, connection.upcomingError == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            } else if connection.upcoming != nil, shown.isEmpty {
                MessageTile(title: "Nothing planned", message: emptyMessage, systemImage: "calendar", color: Palette.releases)
            }
            ForEach(schedule.periods(shown)) { group in
                GroupedSection(header: group.period.title) {
                    ForEach(group.items) { item in
                        if item.opensFix {
                            NavigationLink { FixesView() } label: { UpcomingRow(item: item, when: schedule.when(item)) }
                                .buttonStyle(.plain)
                                .accessibilityHint("Opens To fix")
                        } else if let title = libraryItem(item) {
                            Button { selected = title } label: { UpcomingRow(item: item, when: schedule.when(item)) }
                                .buttonStyle(.plain)
                                .accessibilityHint("Opens it in the Library")
                        } else {
                            UpcomingRow(item: item, when: schedule.when(item), opens: false)
                        }
                    }
                }
            }
        }
        .refreshable {
            await connection.loadUpcoming()
            if connection.library == nil { await connection.loadLibrary() }
        }
        .task {
            await connection.loadUpcoming()
            if connection.library == nil { await connection.loadLibrary() }
        }
        .sheet(item: $selected) { title in
            TitleDetailView(item: title)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    /// The release's title in the Library, once the Library is loaded.
    private func libraryItem(_ item: UpcomingItem) -> LibraryItem? {
        guard let id = item.libraryId else { return nil }
        return connection.library?.items.first { $0.id == id }
    }

    private var emptyMessage: String {
        switch filter {
        case .all: "Nothing coming or going in the next 14 days."
        case .coming: "Nothing out in the next 14 days."
        case .going: "Nothing going. Reclaimerr and Cleanuparr plan nothing."
        }
    }

    /// What's missing from the list, and why.
    private var notes: [String] {
        guard let upcoming = connection.upcoming else { return [] }
        var notes: [String] = []
        let silent = upcoming.unavailable.filter { $0 != .qbittorrent }.map(\.name)
        if !silent.isEmpty {
            notes.append("\(silent.joined(separator: " and ")) didn't answer: \(silent.count == 1 ? "its" : "their") plans are missing. Pull to try again.")
        }
        if upcoming.unavailable.contains(.qbittorrent) {
            notes.append("qBittorrent didn't answer: some of the space back is unknown.")
        }
        if upcoming.homeOutdated {
            notes.append("Update Quai Home to see Cleanuparr's seed cleanups and the space that comes back.")
        }
        return notes
    }
}

extension Components.Schemas.UpcomingService {
    var name: String {
        switch self {
        case .radarr: "Radarr"
        case .sonarr: "Sonarr"
        case .reclaimerr: "Reclaimerr"
        case .cleanuparr: "Cleanuparr"
        case .qbittorrent: "qBittorrent"
        }
    }
}

/// One row: its poster, who does it over the title, when under it, and the space it gives back.
struct UpcomingRow: View {
    let item: UpcomingItem
    let when: String
    var compact = false
    var opens = true

    private var posterWidth: CGFloat { compact ? 32 : 40 }

    var body: some View {
        HStack(spacing: 12) {
            PosterThumbnail(url: PosterSize.small.url(item.posterUrl), width: posterWidth, cornerRadius: posterWidth * 0.2) {
                SymbolSquare(systemImage: item.symbol, color: item.tint, size: posterWidth)
            }
            .frame(width: posterWidth, height: posterWidth * 1.5)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.service.name.uppercased())
                    .font(QuaiFont.tag)
                    .tracking(0.6)
                    .foregroundStyle(item.tint)
                HStack(spacing: 4) {
                    Text(item.title)
                        .lineLimit(1)
                    if let episode = item.episode {
                        Text("· \(episode)")
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                .font(compact ? QuaiFont.subheadline.weight(.semibold) : QuaiFont.bodyEmphasized)
                .foregroundStyle(Palette.primaryText)
                HStack(spacing: 4) {
                    Text(when)
                        .foregroundStyle(Palette.secondaryText)
                    if let freesBytes = item.freesBytes, let freedText = item.freedText {
                        Text(freedText)
                            .fontWeight(.semibold)
                            .foregroundStyle(Palette.ok)
                            .accessibilityLabel("frees \(Format.bytes(freesBytes))")
                    }
                }
                .font(QuaiFont.caption.monospacedDigit())
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            if item.opens, opens, !compact {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
        }
        .padding(.horizontal, compact ? 0 : 14)
        .padding(.vertical, compact ? 0 : 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The Home's Upcoming tile: today's rows (four at most), or the next one when nothing is out
/// today, and what goes this week. Hidden when nothing is planned.
struct UpcomingTile: View {
    let upcoming: Components.Schemas.Upcoming

    private var schedule: UpcomingSchedule { UpcomingSchedule(timeZone: upcoming.timeZone) }
    private var today: [UpcomingItem] { upcoming.items.filter { schedule.period($0) == .today } }
    private var next: UpcomingItem? { upcoming.items.first { $0.isComing && schedule.period($0) != .today } }

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: "Upcoming", systemImage: "calendar", color: Palette.releases)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            if today.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nothing out today")
                        .font(QuaiFont.bodyEmphasized)
                        .foregroundStyle(Palette.primaryText)
                    if let next {
                        Text("Next: \(next.headline) · \(schedule.when(next))")
                            .font(QuaiFont.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .lineLimit(1)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(today.prefix(4)) { item in
                        UpcomingRow(item: item, when: schedule.when(item), compact: true)
                    }
                    if today.count > 4 {
                        Text("and \(today.count - 4) more")
                            .font(QuaiFont.caption)
                            .foregroundStyle(Palette.secondaryText)
                            .padding(.leading, 44)
                    }
                }
            }
            if let going = schedule.goingThisWeek(upcoming.items) {
                Text(going)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.toFix)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens what's coming and going")
    }
}
