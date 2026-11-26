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

    var systemImage: String {
        switch self {
        case .toFix: "wrench.and.screwdriver.fill"
        case .requests: "person.crop.circle.badge.questionmark"
        case .upcoming: "calendar"
        case .alerts: "exclamationmark.triangle.fill"
        case .recentlyAdded: "sparkles"
        case .wanted: "magnifyingglass"
        case .storage: "internaldrive.fill"
        }
    }

    var color: Color {
        switch self {
        case .toFix: Palette.toFix
        case .requests: Palette.requests
        case .upcoming: Palette.releases
        case .alerts: Palette.alert
        case .recentlyAdded, .wanted: Palette.accent
        case .storage: Palette.accent
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

    /// As the preferences keep it: every tile in order, the hidden ones by name.
    var preferences: Components.Schemas.HomeTiles {
        .init(
            order: rows.flatMap(\.tiles).map(\.rawValue),
            hidden: HomeTile.allCases.filter(hidden.contains).map(\.rawValue)
        )
    }
}

/// Settings → Home tiles: the Home's rows in this iPhone's order, dragged by their handle, and a
/// switch per tile. Saved in the iPhone's preferences, on the server.
struct HomeTilesView: View {
    @Environment(Connection.self) private var connection
    @State private var preferences: Components.Schemas.DevicePreferences?
    @State private var layout = HomeLayout.standard
    @State private var status: String?

    var body: some View {
        List {
            Section {
                ForEach(layout.rows) { row in
                    VStack(spacing: 10) {
                        ForEach(row.tiles) { tile in
                            Toggle(isOn: shows(tile)) {
                                HStack(spacing: 12) {
                                    SymbolSquare(systemImage: tile.systemImage, color: tile.color, size: 30)
                                    Text(tile.title)
                                        .font(QuaiFont.body)
                                        .foregroundStyle(Palette.primaryText)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .contain)
                    .accessibilityHint(row == .highlights ? "Two square tiles, side by side on the Home" : "")
                    .listRowBackground(Palette.tile)
                }
                .onMove { from, to in
                    var rows = layout.rows
                    rows.move(fromOffsets: from, toOffset: to)
                    save(HomeLayout(rows: rows, hidden: layout.hidden))
                }
            } header: {
                Text("Drag to reorder")
            } footer: {
                Text("A tile with nothing to show stays out of the Home, wherever it is. Recently added and Wanted share a row.")
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
        .navigationTitle("Home tiles")
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
    }

    private func shows(_ tile: HomeTile) -> Binding<Bool> {
        Binding(
            get: { !layout.hidden.contains(tile) },
            set: { on in
                var hidden = layout.hidden
                if on { hidden.remove(tile) } else { hidden.insert(tile) }
                save(HomeLayout(rows: layout.rows, hidden: hidden))
            }
        )
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
