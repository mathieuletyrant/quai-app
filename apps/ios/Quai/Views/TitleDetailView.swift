import SwiftUI

/// A title of the library, opened from its poster: where it stands, its size, its story, and for
/// a series, its other seasons to request through Seerr.
struct TitleDetailView: View {
    let item: LibraryItem
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var choosingSeasons: SearchResult?
    @State private var requesting = false
    @State private var notice: String?
    @State private var failure: String?

    /// The series to request more seasons of, when Quai Home reaches Seerr.
    private var requestable: SearchResult? {
        connection.reaches(.seerr) ? item.seerrSeries : nil
    }

    private var statusLine: (text: String, color: Color) {
        switch item.status {
        case .available:
            if let have = item.episodes?.have, have > 0 {
                return ("Available · \(have == 1 ? "1 episode" : "\(have) episodes") on disk", Palette.ok)
            }
            return ("Available", Palette.ok)
        case .downloading:
            return (["Downloading", item.progress.map(Format.percent)].compactMap(\.self).joined(separator: " · "), Palette.downloads)
        case .wanted:
            return (item.kind == .movie ? "Wanted · no file yet" : "Wanted · episodes missing", Palette.wantedText)
        case .notAvailable:
            return (item.kind == .movie ? "Not available · not out yet" : "Nothing missing · nothing to download", Palette.secondaryText)
        case .notMonitored:
            return ("Not monitored", Palette.secondaryText)
        }
    }

    /// "8 of 10 on disk", out of Sonarr's count (monitored aired episodes, plus every one with a
    /// file); nil when that count is 0.
    private var episodesLine: String? {
        guard let episodes = item.episodes, episodes.total > 0 else { return nil }
        return "\(episodes.have) of \(episodes.total) on disk"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Spacer()
                    GlassIconButton(systemImage: "xmark", label: "Close") { dismiss() }
                }
                HStack(alignment: .bottom, spacing: 16) {
                    Poster(url: item.posterThumbnail, title: item.title, cornerRadius: 14)
                        .frame(width: 104)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title)
                            .font(QuaiFont.title)
                            .tracking(-0.3)
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(3)
                        Text(item.caption)
                            .font(.system(size: 14))
                            .foregroundStyle(Palette.secondaryText)
                        Text(statusLine.text)
                            .font(QuaiFont.eyebrow)
                            .foregroundStyle(statusLine.color)
                    }
                    .padding(.bottom, 4)
                }
                if item.status == .downloading, let progress = item.progress {
                    ProgressBar(value: progress, color: Palette.downloads)
                }
                if let notice {
                    MessageTile(title: "Requested", message: notice, systemImage: "checkmark.circle.fill", color: Palette.ok)
                }
                if let series = requestable {
                    if requesting {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Button("Request more seasons") { choosingSeasons = series }
                            .buttonStyle(PillButtonStyle())
                            .accessibilityIdentifier("request-more-seasons")
                    }
                }
                GroupedSection {
                    if let episodesLine {
                        ListRow(title: "Episodes", value: episodesLine)
                    }
                    ListRow(title: "On disk", value: item.sizeBytes > 0 ? Format.bytes(item.sizeBytes) : (item.status == .notMonitored ? "Nothing" : "Nothing yet"))
                    if let addedAt = item.addedAt {
                        ListRow(title: "Added", value: Date(timeIntervalSince1970: addedAt).formatted(date: .abbreviated, time: .omitted))
                    }
                    ListRow(title: "In", value: item.serviceName)
                }
                if let page = item.webURL(atHome: connection.isAtHome) {
                    GroupedSection {
                        Link(destination: page) {
                            ListRow(title: "Open in \(item.serviceName)", systemImage: "arrow.up.right.square", iconColor: Palette.accent, chevron: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("open-in-service")
                    }
                }
                if let overview = item.overview {
                    Card(spacing: 8) {
                        Text("STORY").font(QuaiFont.eyebrow).foregroundStyle(Palette.secondaryText)
                        Text(overview)
                            .font(QuaiFont.subheadline)
                            .foregroundStyle(Palette.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(Metrics.gutter)
        }
        .scrollIndicators(.hidden)
        .background(Palette.background.ignoresSafeArea())
        .sheet(item: $choosingSeasons) { series in
            SeasonPicker(result: series) { seasons in send(series, seasons: seasons) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .alert("Couldn't request it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func send(_ series: SearchResult, seasons: [Int]) {
        requesting = true
        notice = nil
        Task {
            do {
                let created = try await connection.request(series, seasons: seasons)
                notice = created.status == .approved
                    ? "\(seasons.count == 1 ? "Season \(seasons[0])" : "\(seasons.count) seasons") on the way."
                    : "Waits for approval in Seerr."
                await connection.loadLibrary()
            } catch {
                failure = error.message(replacing: failure)
            }
            requesting = false
        }
    }
}
