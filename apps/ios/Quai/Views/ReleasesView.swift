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
