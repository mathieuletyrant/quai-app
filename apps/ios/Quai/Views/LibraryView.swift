import SwiftUI

typealias LibraryItem = Components.Schemas.LibraryItem

extension Components.Schemas.LibraryItem: Identifiable {}

extension Components.Schemas.LibraryItem {
    var kindLabel: String { kind == .movie ? "Movie" : "Series" }

    /// "Movie · 2024"
    var caption: String { [kindLabel, year.map { String($0) }].compactMap { $0 }.joined(separator: " · ") }

    /// The grid's poster, 342 px wide.
    var posterThumbnail: URL? { PosterSize.grid.url(posterUrl) }

    var posterLarge: URL? { PosterSize.large.url(posterUrl) }

    var serviceName: String { kind == .movie ? "Radarr" : "Sonarr" }

    /// The title's page in Radarr or Sonarr: the address at home while the app reaches Quai at
    /// home, the last one (from outside) otherwise.
    func webURL(atHome: Bool) -> URL? {
        guard let urls = webUrls, let chosen = atHome ? urls.first : urls.last else { return nil }
        return URL(string: chosen)
    }
}

/// What the segmented control shows.
enum LibraryScope: String, CaseIterable, Identifiable {
    case all = "All", movies = "Movies", series = "Series"
    var id: Self { self }

    func includes(_ item: LibraryItem) -> Bool {
        switch self {
        case .all: true
        case .movies: item.kind == .movie
        case .series: item.kind == .series
        }
    }
}

/// The chips under it: everything newest first, or only what's missing or downloading.
enum LibraryFilter: Hashable {
    case recent, wanted, downloading

    func includes(_ item: LibraryItem) -> Bool {
        switch self {
        case .recent: true
        case .wanted: item.status == .wanted
        case .downloading: item.status == .downloading
        }
    }
}

/// The Library tab: the home's movies and series, as posters.
struct LibraryView: View {
    @Environment(Connection.self) private var connection
    @State private var scope = LibraryScope.all
    @State private var filter = LibraryFilter.recent
    @State private var selected: LibraryItem?
    @State private var loading = false

    private let columns = [GridItem(.adaptive(minimum: Metrics.minPosterWidth), spacing: 10, alignment: .top)]

    private var inScope: [LibraryItem] { (connection.library?.items ?? []).filter(scope.includes) }
    private var shown: [LibraryItem] { inScope.filter(filter.includes) }

    var body: some View {
        NavigationStack {
            Screen {
                TabHeader(eyebrow: summary, title: "Library")
            } content: {
                Picker("Show", selection: $scope) {
                    ForEach(LibraryScope.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                chips
                if let error = connection.libraryError {
                    MessageTile(title: "Can't load the library", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let unavailable = connection.library?.unavailable, !unavailable.isEmpty {
                    Text(unavailableNote(unavailable))
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .padding(.horizontal, 4)
                }
                grid
            }
            .refreshable { await connection.loadLibrary() }
            .task {
                guard connection.library == nil else { return }
                loading = true
                await connection.loadLibrary()
                loading = false
            }
        }
        .sheet(item: $selected) { item in
            TitleDetailView(item: item)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    /// "137 titles · 759 GB free"; "Loading…" while it loads, "Not loaded" after a failure.
    private var summary: String {
        guard let library = connection.library else {
            if loading { return "Loading…" }
            return connection.libraryError == nil ? "" : "Not loaded"
        }
        var parts = [library.items.count == 1 ? "1 title" : "\(library.items.count) titles"]
        if let disk = library.disk {
            parts.append("\(Format.bytes(disk.freeBytes)) free")
        }
        return parts.joined(separator: " · ")
    }

    private func unavailableNote(_ services: [Components.Schemas.LibraryService]) -> String {
        let names = services.map { $0 == .radarr ? "Radarr" : "Sonarr" }.joined(separator: " and ")
        return "\(names) didn't answer: \(services.count == 1 ? "its" : "their") titles are missing. Pull to try again."
    }

    private var chips: some View {
        let wanted = inScope.filter { $0.status == .wanted }.count
        let downloading = inScope.filter { $0.status == .downloading }.count
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Chip(title: "Recent", selected: filter == .recent) { filter = .recent }
                if downloading > 0 || filter == .downloading {
                    Chip(title: "Downloading · \(downloading)", selected: filter == .downloading) { filter = .downloading }
                }
                Chip(title: "Wanted · \(wanted)", selected: filter == .wanted) { filter = .wanted }
            }
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder private var grid: some View {
        if connection.library != nil && shown.isEmpty {
            MessageTile(
                title: filter == .recent ? "Nothing here yet" : "Nothing to show",
                message: filter == .recent
                    ? "Movies from Radarr and series from Sonarr show up here."
                    : "No title matches this filter.",
                systemImage: "film.stack",
                color: Palette.accent
            )
        } else if connection.library == nil && loading {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                ForEach(shown) { item in
                    Button { selected = item } label: { PosterCell(item: item) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("title-\(item.id)")
                }
            }
            .padding(.top, 4)
        }
    }
}

private struct Chip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(QuaiFont.eyebrow)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .foregroundStyle(selected ? Palette.accent : Color(hex: "#D1D1D6"))
                .overlay(Capsule().strokeBorder(selected ? Palette.accent : Color.white.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// One poster of the grid, 2:3, with its title and caption under it.
struct PosterCell: View {
    let item: LibraryItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Poster(url: item.posterThumbnail, title: item.title, cornerRadius: 12)
                .overlay(alignment: .topTrailing) { StatusBadge(item: item).padding(6) }
            Text(item.title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.primaryText)
                .lineLimit(1)
            Text(item.caption)
                .font(.system(size: 11))
                .foregroundStyle(Palette.tertiaryText)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// "wanted" or the download's percent, on the poster's corner. Nothing once on disk, nor when
/// Radarr or Sonarr isn't looking for it (not monitored, or not out yet).
struct StatusBadge: View {
    let item: LibraryItem

    var body: some View {
        switch item.status {
        case .available, .notAvailable, .notMonitored:
            EmptyView()
        case .wanted:
            Badge(text: "wanted", fill: Palette.wantedFill, color: Palette.wantedText)
        case .downloading:
            Badge(text: item.progress.map(Format.percent) ?? "downloading", fill: Color(hex: "#3A3220"), color: Palette.downloads)
        }
    }
}
