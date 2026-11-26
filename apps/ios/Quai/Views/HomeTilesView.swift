import SwiftUI

/// One tile of the Home tab, by the name the iPhone's preferences keep (GLOSSARY: Home tiles).
enum HomeTile: String, CaseIterable, Identifiable {
    case toFix, requests, upcoming, alerts, recentlyAdded, wanted, storage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .toFix: "To fix"
        case .requests: "Requests"
        case .upcoming: "Upcoming"
        case .alerts: "Alerts"
        case .recentlyAdded: "Recently added"
        case .wanted: "Wanted"
        case .storage: "Storage"
        }
    }
}

/// One row of the Home: a tile, or Recently added and Wanted side by side.
enum HomeRow: Hashable, Identifiable {
    case single(HomeTile)
    case highlights

    var id: String {
        switch self {
        case let .single(tile): tile.rawValue
        case .highlights: "highlights"
        }
    }

    /// Its tiles, as they sit in the row.
    var tiles: [HomeTile] {
        switch self {
        case let .single(tile): [tile]
        case .highlights: [.recentlyAdded, .wanted]
        }
    }
}

/// The Home's rows from the iPhone's preferences: its order, then any tile it doesn't list yet (a
/// tile added since) in the app's order; names it doesn't know skipped. Recently added and Wanted
/// share a row, placed where the first of them is.
struct HomeLayout: Equatable {
    let rows: [HomeRow]
    let hidden: Set<HomeTile>

    static let standard = HomeLayout(nil)

    init(_ tiles: Components.Schemas.HomeTiles?) {
        let listed = (tiles?.order ?? []).compactMap(HomeTile.init(rawValue:))
        var rows: [HomeRow] = []
        for tile in listed + HomeTile.allCases {
            let row: HomeRow = tile == .recentlyAdded || tile == .wanted ? .highlights : .single(tile)
            if !rows.contains(row) { rows.append(row) }
        }
        self.rows = rows
        hidden = Set((tiles?.hidden ?? []).compactMap(HomeTile.init(rawValue:)))
    }

    init(rows: [HomeRow], hidden: Set<HomeTile>) {
        self.rows = rows
        self.hidden = hidden
    }

    /// The row's tiles this iPhone shows; none: the row is hidden.
    func shown(_ row: HomeRow) -> [HomeTile] { row.tiles.filter { !hidden.contains($0) } }

    /// The rows on the Home, in order: those with a tile shown.
    var shownRows: [HomeRow] { rows.filter { !shown($0).isEmpty } }

    /// The hidden tiles, in the rows' order: one by one, Recently added and Wanted apart.
    var hiddenTiles: [HomeTile] { rows.flatMap(\.tiles).filter(hidden.contains) }

    /// With every tile of this row hidden.
    func hiding(_ row: HomeRow) -> HomeLayout { HomeLayout(rows: rows, hidden: hidden.union(row.tiles)) }

    /// With this tile back on the Home, where its row is.
    func showing(_ tile: HomeTile) -> HomeLayout { HomeLayout(rows: rows, hidden: hidden.subtracting([tile])) }

    /// With the shown rows moved as a list does; the hidden rows keep their place among them.
    func moving(from source: IndexSet, to destination: Int) -> HomeLayout {
        var moved = shownRows
        moved.move(fromOffsets: source, toOffset: destination)
        var next = moved.makeIterator()
        return HomeLayout(rows: rows.map { shown($0).isEmpty ? $0 : next.next() ?? $0 }, hidden: hidden)
    }

    /// As the preferences keep it: every tile in order, the hidden ones by name.
    var preferences: Components.Schemas.HomeTiles {
        .init(
            order: rows.flatMap(\.tiles).map(\.rawValue),
            hidden: HomeTile.allCases.filter(hidden.contains).map(\.rawValue)
        )
    }
}

/// Settings → Home tiles: the rows on the Home, dragged by their handle and hidden with −, then
/// the hidden tiles, put back with +. Saved in the iPhone's preferences, on the server.
struct HomeTilesView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var layout = HomeLayout.standard
    @State private var status: String?

    var body: some View {
        List {
            Section {
                ForEach(layout.shownRows) { row in
                    TileEditRow(title: title(row), pair: row == .highlights, action: .hide) {
                        save(layout.hiding(row))
                    }
                }
                .onMove { from, to in save(layout.moving(from: from, to: to)) }
            } header: {
                Text("On the Home")
            } footer: {
                Text("A tile with nothing to show stays out of the Home, wherever it is.")
            }
            if !layout.hiddenTiles.isEmpty {
                Section("Hidden") {
                    ForEach(layout.hiddenTiles) { tile in
                        TileEditRow(title: tile.title, pair: false, action: .show) { save(layout.showing(tile)) }
                            .moveDisabled(true)
                    }
                }
            }
            if layout != .standard {
                Section {
                    Button("Reset to the default order") { save(.standard) }
                        .foregroundStyle(Palette.accent)
                        .listRowBackground(Palette.tile)
                }
            }
            if let status {
                Text(status)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.toFix)
                    .listRowBackground(Color.clear)
            }
        }
        .environment(\.editMode, .constant(.active))
        .scrollContentBackground(.hidden)
        .background(Palette.background.ignoresSafeArea())
        .disabled(preferences == nil)
        .animation(.smooth(duration: 0.25), value: layout)
        .navigationTitle("Home tiles")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
    }

    /// A row's name: its tiles shown, "Recently added · Wanted" for the pair.
    private func title(_ row: HomeRow) -> String {
        layout.shown(row).map(\.title).joined(separator: " · ")
    }

    private func load() async {
        do {
            let read = try await connection.preferences()
            preferences = read
            layout = HomeLayout(read.homeTiles)
        } catch {
            status = error.message(replacing: status)
        }
    }

    private func save(_ next: HomeLayout) {
        guard var saved = preferences else { return }
        layout = next
        saved.homeTiles = next == .standard ? nil : next.preferences
        preferences = saved
        let sent = saved
        Task {
            do {
                try await connection.save(sent)
                status = nil
            } catch {
                status = error.message(replacing: status)
            }
        }
    }
}

/// One row of the Home tiles list: − to hide what's on the Home, + to put a hidden tile back.
private struct TileEditRow: View {
    enum Action { case hide, show }

    let title: String
    /// Recently added and Wanted, one row of two squares on the Home.
    let pair: Bool
    let action: Action
    let perform: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: perform) {
                Image(systemName: action == .hide ? "minus.circle.fill" : "plus.circle.fill")
                    .font(.system(size: 22))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, action == .hide ? Palette.alert : Palette.ok)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(action == .hide ? "Hide \(title)" : "Show \(title)")
            Text(title)
                .font(QuaiFont.body)
                .foregroundStyle(action == .hide ? Palette.primaryText : Palette.secondaryText)
            if pair {
                Image(systemName: "square.split.2x1")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.tertiaryText)
                    .accessibilityLabel("two square tiles side by side")
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
        .listRowBackground(Palette.tile)
    }
}
