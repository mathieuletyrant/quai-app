import SwiftUI

typealias JournalEntry = Components.Schemas.JournalEntry

extension JournalEntry {
    /// A symbol and a color for what happened.
    var look: (systemImage: String, color: Color) {
        switch kind {
        case "media.added": ("plus.circle.fill", Palette.requests)
        case "media.grabbed": ("arrow.down.circle.fill", Palette.downloads)
        case "media.imported": ("tray.and.arrow.down.fill", Palette.downloads)
        case "media.available": ("checkmark.circle.fill", Palette.ok)
        case "playback.started", "playback.stopped": ("play.fill", Palette.playback)
        case "alert.raised": ("exclamationmark.triangle.fill", Palette.incident)
        case "alert.over": ("checkmark.circle.fill", Palette.ok)
        case "request.pending", "request.approved", "request.declined": ("person.fill.questionmark", Palette.requests)
        case "releases.available": ("calendar", Palette.releases)
        default: ("circle.fill", Palette.secondaryText)
        }
    }

    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// One line of the journal: what happened, and when.
struct JournalRow: View {
    let entry: JournalEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: entry.look.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(entry.look.color)
                .frame(width: 18)
            Text(entry.text)
                .font(QuaiFont.subheadline)
                .foregroundStyle(Palette.primaryText)
                .lineLimit(2)
            Spacer(minLength: 8)
            Text(entry.date, format: .relative(presentation: .named, unitsStyle: .narrow))
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
                .lineLimit(1)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }
}

/// The Home's last few lines of the journal; the rest is in the Activity tab.
struct RecentTile: View {
    let entries: [JournalEntry]

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: "Recent", systemImage: "clock.arrow.circlepath", color: Palette.accent)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(entries.prefix(3), id: \.id) { entry in
                    JournalRow(entry: entry)
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityHint("Opens the Activity tab")
    }
}

/// The media disk as the Storage tile reads it.
struct DiskReading: Equatable {
    let freeBytes: Double
    let totalBytes: Double

    init(_ disk: Components.Schemas.DiskSpace) {
        freeBytes = disk.freeBytes
        totalBytes = disk.totalBytes
    }

    var usedShare: Double { totalBytes > 0 ? 1 - freeBytes / totalBytes : 0 }

    /// "85% used"
    var caption: String { "\(Format.percent(usedShare)) used" }
}

/// The media disk: free space, and a bar that fills up.
struct StorageTile: View {
    let reading: DiskReading
    /// The Low disk space alert is going on.
    var isLow = false

    private var color: Color { isLow ? Palette.toFix : Palette.accent }

    var body: some View {
        Tile {
            HStack {
                TileLabel(title: "Storage", systemImage: "internaldrive.fill", color: color)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Format.bytes(reading.freeBytes))
                    .font(QuaiFont.value)
                    .monospacedDigit()
                    .foregroundStyle(isLow ? Palette.toFix : Palette.primaryText)
                Text("free")
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
                Spacer(minLength: 8)
                Text("of \(Format.bytes(reading.totalBytes))")
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
            ProgressBar(value: reading.usedShare, color: color, height: 8)
                .accessibilityHidden(true)
            Text(reading.caption)
                .font(QuaiFont.caption)
                .foregroundStyle(Palette.secondaryText)
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the library")
    }
}
