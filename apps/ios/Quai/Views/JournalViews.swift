import SwiftUI

typealias JournalEntry = Components.Schemas.JournalEntry

extension JournalEntry {
    /// A symbol and a color for what happened.
    var look: (systemImage: String, color: Color) {
        switch kind {
        case "media.added": ("plus.circle.fill", Palette.requests)
        case "media.grabbed": ("arrow.down.circle.fill", Palette.downloads)
        case "media.imported": ("tray.and.arrow.down.fill", Palette.downloads)
        case "media.importBlocked": ("exclamationmark.triangle.fill", Palette.toFix)
        case "download.removed": ("xmark.circle.fill", Palette.stalled)
        case "media.available": ("checkmark.circle.fill", Palette.ok)
        case "playback.started", "playback.stopped": ("play.fill", Palette.playback)
        case "alert.raised": ("exclamationmark.triangle.fill", Palette.alert)
        case "alert.over": ("checkmark.circle.fill", Palette.ok)
        case "reclaimerr.deleted", "reclaimerr.moved", "cleanuparr.removed", "cleanuparr.cleaned":
            ("trash.circle.fill", Palette.secondaryText)
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

/// The media disk as the Storage tile reads it.
struct DiskReading: Equatable {
    let freeBytes: Double
    let totalBytes: Double

    init(_ disk: Components.Schemas.DiskSpace) {
        freeBytes = disk.freeBytes
        totalBytes = disk.totalBytes
    }

    var usedShare: Double { totalBytes > 0 ? 1 - freeBytes / totalBytes : 0 }

    /// "793 GB"
    var free: String { Format.bytes(freeBytes) }

    /// "free of 1.96 TB"
    var ofTotal: String { "free of \(Format.bytes(totalBytes))" }
}

/// The media disk on one line: the free space, and a bar that fills up.
struct StorageTile: View {
    let reading: DiskReading
    /// The Low disk space alert is going on.
    var isLow = false

    private var color: Color { isLow ? Palette.toFix : Palette.accent }

    var body: some View {
        Tile {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "internaldrive.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(color)
                Text(reading.free)
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(isLow ? Palette.toFix : Palette.primaryText)
                Text(reading.ofTotal)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.tertiaryText)
            }
            ProgressBar(value: reading.usedShare, color: color)
                .accessibilityHidden(true)
        }
        .contentShape(RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the library")
    }
}
