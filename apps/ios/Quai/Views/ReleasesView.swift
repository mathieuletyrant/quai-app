import SwiftUI

typealias DayRelease = Components.Schemas.DayRelease

extension DayRelease {
    /// "Severance · S02E03", "The Wild Robot"
    var headline: String { episode.map { "\(title) · \($0)" } ?? title }

    /// "21:00" in this iPhone's time; "Today" for a movie, whose release has no time.
    var airTime: String {
        guard let airsAt else { return "Today" }
        return Date(timeIntervalSince1970: airsAt).formatted(date: .omitted, time: .shortened)
    }
}

/// One line of the Home's Today tile: a movie, or every episode of one series out today.
struct TodayLine: Equatable {
    let id: String
    let airTime: String
    let title: String
    /// "S01E03", "S02E04–E05", "S02E04, E07"; nil for a movie.
    let episodes: String?
    /// The least advanced of its releases: "here" only once they all are.
    let status: Components.Schemas.DayReleaseStatus
    let releaseCount: Int

    /// The releases in their order, a series' episodes folded into its first line.
    static func lines(_ releases: [DayRelease]) -> [TodayLine] {
        var groups: [[DayRelease]] = []
        for release in releases {
            let sameSeries = groups.firstIndex { group in
                release.kind.rawValue == "episode" && group[0].kind.rawValue == "episode" && group[0].title == release.title
            }
            if let sameSeries {
                groups[sameSeries].append(release)
            } else {
                groups.append([release])
            }
        }
        return groups.map { group in
            TodayLine(
                id: group[0].id,
                airTime: group[0].airTime,
                title: group[0].title,
                episodes: episodeCodes(group.compactMap(\.episode)),
                status: group.map(\.status).min { rank($0) < rank($1) } ?? group[0].status,
                releaseCount: group.count
            )
        }
    }

    /// "S02E04" + "S02E05" → "S02E04–E05"; "S02E04" + "S02E07" → "S02E04, E07".
    static func episodeCodes(_ codes: [String]) -> String? {
        guard let first = codes.first else { return nil }
        guard codes.count > 1 else { return first }
        let parsed = codes.compactMap(parse)
        let oneSeason = parsed.count == codes.count && Set(parsed.map(\.season)).count == 1
        guard oneSeason else { return codes.joined(separator: ", ") }
        let numbers = parsed.map(\.episode).sorted()
        let season = first.prefix { $0 != "E" }
        let consecutive = zip(numbers, numbers.dropFirst()).allSatisfy { previous, next in next == previous + 1 }
        if consecutive {
            return "\(season)\(episodeLabel(numbers[0]))–\(episodeLabel(numbers[numbers.count - 1]))"
        }
        return season + numbers.map(episodeLabel).joined(separator: ", ")
    }

    private static func parse(_ code: String) -> (season: Int, episode: Int)? {
        let parts = code.dropFirst().split(separator: "E")
        guard code.hasPrefix("S"), parts.count == 2, let season = Int(parts[0]), let episode = Int(parts[1]) else { return nil }
        return (season, episode)
    }

    private static func episodeLabel(_ number: Int) -> String {
        number < 10 ? "E0\(number)" : "E\(number)"
    }

    private static func rank(_ status: Components.Schemas.DayReleaseStatus) -> Int {
        switch status {
        case .missing: 0
        case .grabbed: 1
        case .downloading: 2
        case .available: 3
        }
    }
}

/// Where a release stands, in a word and a color.
struct ReleaseStatusLabel: View {
    let status: Components.Schemas.DayReleaseStatus

    private var label: (text: String, color: Color) {
        switch status {
        case .available: ("here", Palette.ok)
        case .downloading: ("downloading", Palette.downloads)
        case .grabbed: ("grabbed", Palette.downloads)
        case .missing: ("not yet", Palette.tertiaryText)
        }
    }

    var body: some View {
        Text(label.text)
            .font(QuaiFont.eyebrow)
            .foregroundStyle(label.color)
    }
}

/// Today's releases, from Sonarr's and Radarr's calendars: when each airs and where it stands.
/// Read only: Quai never grabs anything for them.
struct ReleasesView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss

    private var items: [DayRelease] { connection.releases?.items ?? [] }

    private var summary: String? {
        guard let releases = connection.releases else { return nil }
        let here = releases.items.filter { $0.status == .available }.count
        return releases.items.isEmpty ? "Nothing comes out today" : "\(here) of \(releases.items.count) here"
    }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "Today", subtitle: summary)
        } content: {
            if let error = connection.releasesError {
                MessageTile(title: "Can't load the releases", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            if let unavailable = connection.releases?.unavailable, !unavailable.isEmpty {
                Text("\(unavailable.map { $0 == .radarr ? "Radarr" : "Sonarr" }.joined(separator: " and ")) didn't answer: pull to try again.")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
            if connection.releases == nil && connection.releasesError == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            }
            ForEach(items, id: \.id) { release in
                Card(spacing: 0) {
                    HStack(alignment: .top, spacing: 12) {
                        PosterThumbnail(url: PosterSize.small.url(release.posterUrl), width: 44, cornerRadius: 9) {
                            SymbolSquare(systemImage: release.kind.rawValue == "movie" ? "film" : "tv", color: Palette.releases, size: 44)
                        }
                        .frame(width: 44, height: 66)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(release.headline)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Palette.primaryText)
                            if let episodeTitle = release.episodeTitle {
                                Text(episodeTitle).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
                            }
                            Text(release.airTime).font(QuaiFont.caption.monospacedDigit()).foregroundStyle(Palette.secondaryText)
                        }
                        Spacer(minLength: 8)
                        ReleaseStatusLabel(status: release.status)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .refreshable { await connection.loadReleases() }
        .task { await connection.loadReleases() }
    }
}
