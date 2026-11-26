import SwiftUI

typealias StorageDisk = Components.Schemas.StorageDisk
typealias DiskMark = Components.Schemas.DiskMark

extension Components.Schemas.StorageDisk: Identifiable {}

extension Components.Schemas.DiskMark: Identifiable {
    var date: Date { Date(timeIntervalSince1970: at / 1000) }

    /// ↓ for what arrived (it takes room), ↑ for what's gone (it may give some back).
    var symbol: String { kind == .arrived ? "arrow.down" : "arrow.up" }

    /// The service's color: who did it.
    var color: Color { ServiceLook.color(service.rawValue) }

    /// What it did to the free space: "−11 GB" taken, "+6 GB" surely back; nothing when Quai can't say.
    var sizeText: String? {
        guard let bytes, bytes > 0 else { return nil }
        return (kind == .arrived ? "−" : "+") + Format.bytes(bytes)
    }

    /// The arrow over the service's color: dark on the bright ones, white on the deep ones.
    var ink: Color { service == .radarr || service == .sonarr ? Palette.background : .white }
}

extension Components.Schemas.DiskReading {
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// The stretch of time the Storage screen shows, as the segmented control names it.
enum StoragePeriod: String, CaseIterable, Identifiable {
    case week = "7d", month = "30d", year = "1y", all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .week: "1W"
        case .month: "1M"
        case .year: "1Y"
        case .all: "All"
        }
    }

    /// Hourly readings up to 30 days: the cursor says the hour too.
    var isHourly: Bool { self == .week || self == .month }

    var api: Components.Schemas.StoragePeriod? { .init(rawValue: rawValue) }
}

extension Components.Schemas.StorageDisk {
    var usedShare: Double { totalBytes > 0 ? 1 - freeBytes / totalBytes : 0 }

    /// "MOVIES · SHOWS"
    var label: String { name.uppercased() }

    /// The mark nearest a date, for a tap on the chart.
    func nearestMark(to date: Date) -> DiskMark? {
        marks.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
    }
}

/// Storage: each media disk's free space over time, and what changed it (GLOSSARY: disk
/// readings, disk marks). One card per disk, the fullest first; the selected one lists its marks
/// below, and a mark tapped there (or on the chart) shows on the chart.
struct StorageView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @State private var period: StoragePeriod = .month
    @State private var selectedDisk: String?
    @State private var selectedMark: String?
    @State private var showsAllMarks = false

    private var storage: Components.Schemas.Storage? { connection.storage }
    private var disks: [StorageDisk] { storage?.disks ?? [] }
    /// One disk is always selected: the one tapped, else the fullest.
    private var disk: StorageDisk? { disks.first { $0.id == selectedDisk } ?? disks.first }

    var body: some View {
        Screen {
            HStack {
                GlassIconButton(systemImage: "chevron.left", label: "Back") { dismiss() }
                Spacer()
            }
            ScreenHeader(title: "Storage")
        } content: {
            Picker("Period", selection: $period) {
                ForEach(StoragePeriod.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            if let error = connection.storageError {
                MessageTile(title: "Can't read the disks", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            }
            ForEach(notes, id: \.self) { note in
                Text(note)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, 4)
            }
            if connection.awaits(storage, failure: connection.storageError) {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            } else if storage != nil, disks.isEmpty {
                MessageTile(
                    title: "No disk yet",
                    message: "Quai reads Radarr's and Sonarr's disks every hour: the first reading shows here.",
                    systemImage: "internaldrive",
                    color: Palette.accent
                )
            }
            ForEach(disks) { shown in
                DiskCard(
                    disk: shown,
                    period: period,
                    selected: disks.count > 1 && shown.id == disk?.id,
                    mark: shown.id == disk?.id ? selectedMark : nil
                ) { picked in
                    select(shown, mark: picked)
                }
            }
            if let disk {
                marks(of: disk)
            }
        }
        .task(id: period) {
            await connection.loadStorage(period)
            if let selectedMark, disk?.marks.contains(where: { $0.id == selectedMark }) != true { self.selectedMark = nil }
        }
        .refreshable { await connection.loadStorage(period) }
        .sheet(isPresented: $showsAllMarks) {
            if let disk {
                AllMarksView(disk: disk) { picked in
                    showsAllMarks = false
                    selectedMark = picked.id
                    period = .all
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
    }

    /// The disk's marks of the period, newest first, then all of them.
    @ViewBuilder private func marks(of disk: StorageDisk) -> some View {
        if disk.marks.isEmpty {
            if disk.allMarks > 0 { allMarksButton(disk) }
        } else {
            GroupedSection(header: disks.count > 1 ? "\(disk.name) · Marks" : "Marks") {
                ForEach(disk.marks) { mark in
                    Button { select(disk, mark: mark.id == selectedMark ? nil : mark.id) } label: {
                        DiskMarkRow(mark: mark, selected: mark.id == selectedMark)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Shows it on the chart")
                }
                if Int(disk.allMarks) > disk.marks.count { allMarksButton(disk) }
            }
        }
    }

    private func allMarksButton(_ disk: StorageDisk) -> some View {
        Button { showsAllMarks = true } label: {
            ListRow(title: "All \(Int(disk.allMarks)) marks", chevron: true)
        }
        .buttonStyle(.plain)
    }

    private func select(_ disk: StorageDisk, mark: String?) {
        withAnimation(.smooth(duration: 0.2)) {
            if disk.id != self.disk?.id { selectedDisk = disk.id }
            selectedMark = mark
        }
    }

    /// What may be missing, and why.
    private var notes: [String] {
        guard let storage, !storage.unavailable.isEmpty else { return [] }
        let names = storage.unavailable.map { ServiceLook.name($0.rawValue) }
        return ["\(names.joined(separator: " and ")) didn't answer: \(names.count == 1 ? "its" : "their") disks show their last reading. Pull to try again."]
    }
}

/// One media disk: what it holds, its free space now, its chart over the period. Tapping it
/// selects it (its marks list below); tapping the chart picks the nearest mark, pressing and
/// dragging on it moves a cursor along the curve.
struct DiskCard: View {
    let disk: StorageDisk
    let period: StoragePeriod
    /// Outlined: the disk whose marks list below (only among several).
    let selected: Bool
    /// The mark shown on the chart.
    let mark: String?
    let pick: (String?) -> Void

    private var tint: Color { disk.low ? Palette.toFix : Palette.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "internaldrive.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(tint)
                Text(disk.label)
                    .font(QuaiFont.eyebrow)
                    .foregroundStyle(Palette.secondaryText)
                Spacer(minLength: 8)
                if disk.low {
                    Badge(text: "RUNNING LOW", fill: Palette.toFix.opacity(0.16), color: Palette.toFix)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Format.bytes(disk.freeBytes))
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(disk.low ? Palette.toFix : Palette.primaryText)
                Text("free of \(Format.bytes(disk.totalBytes))")
                    .font(QuaiFont.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            if disk.readings.count > 1 {
                DiskChart(disk: disk, period: period, tint: tint, selected: mark) { date in
                    pick(disk.nearestMark(to: date)?.id)
                }
                .frame(height: 170)
            } else {
                ProgressBar(value: disk.usedShare, color: tint)
                Text("The chart starts with the next readings: one an hour.")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.tertiaryText)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.tile, in: RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous)
                .strokeBorder(selected ? Palette.accent : .clear, lineWidth: 2)
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .onTapGesture { pick(nil) }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// One mark: its arrow in the service's color, the title, then who did what, and the day.
struct DiskMarkRow: View {
    let mark: DiskMark
    var selected = false

    var body: some View {
        HStack(spacing: 12) {
            SymbolSquare(systemImage: mark.symbol, color: mark.color, size: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(mark.title)
                    .font(QuaiFont.bodyEmphasized)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(1)
                ServiceLine(services: [mark.service.rawValue], detail: Text(mark.detail))
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(mark.date, format: .dateTime.month(.abbreviated).day())
                    .font(QuaiFont.caption.monospacedDigit())
                    .foregroundStyle(Palette.tertiaryText)
                if let size = mark.sizeText {
                    Text(size)
                        .font(QuaiFont.caption.monospacedDigit())
                        .fontWeight(.semibold)
                        .foregroundStyle(mark.kind == .gone ? Palette.ok : Palette.secondaryText)
                }
            }
            .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(selected ? Palette.raised : .clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Every mark of one disk, whatever the period. Picking one shows it on the chart, over All.
struct AllMarksView: View {
    @Environment(Connection.self) private var connection
    let disk: StorageDisk
    let pick: (DiskMark) -> Void
    @State private var marks: [DiskMark]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Screen {
                ScreenHeader(title: "\(disk.name)", subtitle: "\(Int(disk.allMarks)) marks")
            } content: {
                if let error {
                    MessageTile(title: "Can't read the marks", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                }
                if let marks {
                    GroupedSection {
                        ForEach(marks) { mark in
                            Button { pick(mark) } label: { DiskMarkRow(mark: mark) }
                                .buttonStyle(.plain)
                                .accessibilityHint("Shows it on the chart")
                        }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
        }
        .task {
            do {
                marks = try await connection.storage(.all).disks.first { $0.id == disk.id }?.marks ?? []
            } catch {
                self.error = error.message(replacing: nil)
            }
        }
    }
}
