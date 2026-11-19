import SwiftUI

/// A title of the library, opened from its poster: where it stands, its size, its story.
struct TitleDetailView: View {
    let item: LibraryItem
    @Environment(\.dismiss) private var dismiss

    private var statusLine: (text: String, color: Color) {
        switch item.status {
        case .available:
            return ("Available", Palette.ok)
        case .downloading:
            return (["Downloading", item.progress.map(Format.percent)].compactMap { $0 }.joined(separator: " · "), Palette.downloads)
        case .wanted:
            return (item.kind == .movie ? "Wanted · no file yet" : "Wanted · episodes missing", Palette.wantedText)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Spacer()
                    GlassIconButton(systemImage: "xmark", label: "Close") { dismiss() }
                }
                HStack(alignment: .bottom, spacing: 16) {
                    Poster(url: item.posterLarge, title: item.title, cornerRadius: 14)
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
                GroupedSection {
                    if let episodes = item.episodes {
                        ListRow(title: "Episodes", value: "\(episodes.have) of \(episodes.total)")
                    }
                    ListRow(title: "On disk", value: item.sizeBytes > 0 ? Format.bytes(item.sizeBytes) : "Nothing yet")
                    if let addedAt = item.addedAt {
                        ListRow(title: "Added", value: Date(timeIntervalSince1970: addedAt).formatted(date: .abbreviated, time: .omitted))
                    }
                    ListRow(title: "In", value: item.kind == .movie ? "Radarr" : "Sonarr")
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
    }
}
