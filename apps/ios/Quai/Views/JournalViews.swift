import SwiftUI

typealias JournalEntry = Components.Schemas.JournalEntry

extension JournalEntry {
    /// A symbol and a color for what happened.
    var look: (systemImage: String, color: Color) {
        switch kind {
        case "media.added": ("plus", Palette.requests)
        case "media.grabbed": ("arrow.down", Palette.downloads)
        case "media.imported": ("tray.and.arrow.down.fill", Palette.downloads)
        case "media.importBlocked": ("exclamationmark.triangle.fill", Palette.toFix)
        case "download.removed": ("xmark", Palette.stalled)
        case "media.available": ("checkmark", Palette.ok)
        case "playback.started", "playback.stopped": ("play.fill", Palette.playback)
        case "alert.raised": ("exclamationmark.triangle.fill", Palette.alert)
        case "alert.over": ("checkmark", Palette.ok)
        case "reclaimerr.deleted", "reclaimerr.moved", "cleanuparr.removed", "cleanuparr.cleaned":
            ("trash", Palette.toFix)
        case "request.pending", "request.approved", "request.declined": ("person.fill.questionmark", Palette.requests)
        case "releases.available": ("calendar", Palette.releases)
        default: ("circle.fill", Palette.secondaryText)
        }
    }

    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

extension Components.Schemas.JournalSource {
    /// Who a line is about, as the journal names it: "Sonarr", "Quai Home".
    var name: String {
        switch self {
        case .radarr: "Radarr"
        case .sonarr: "Sonarr"
        case .prowlarr: "Prowlarr"
        case .qbittorrent: "qBittorrent"
        case .jellyfin: "Jellyfin"
        case .seerr: "Seerr"
        case .reclaimerr: "Reclaimerr"
        case .cleanuparr: "Cleanuparr"
        case .apple: "Apple"
        case .home: "Quai Home"
        case .cloud: "Quai Cloud"
        }
    }
}

/// The journal's lines by day, newest first as they came: "Today", "Yesterday", then the date.
struct JournalDay: Identifiable {
    let title: String
    let entries: [JournalEntry]

    var id: String { title }

    static func days(_ entries: [JournalEntry], now: Date = .now, calendar: Calendar = .current) -> [JournalDay] {
        var days: [JournalDay] = []
        for entry in entries {
            let title = dayTitle(entry.date, now: now, calendar: calendar)
            if let last = days.last, last.title == title {
                days[days.count - 1] = JournalDay(title: title, entries: last.entries + [entry])
            } else {
                days.append(JournalDay(title: title, entries: [entry]))
            }
        }
        return days
    }

    /// "Today", "Yesterday", "Mon, Nov 24".
    static func dayTitle(_ date: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}

/// One line of the journal: who it's about and when, over what happened, like a row of Upcoming.
struct JournalRow: View {
    let entry: JournalEntry

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            SymbolSquare(systemImage: entry.look.systemImage, color: entry.look.color, size: 30)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.source.name.uppercased())
                        .font(QuaiFont.tag)
                        .tracking(0.6)
                        .foregroundStyle(entry.look.color)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(entry.date, format: .relative(presentation: .named, unitsStyle: .narrow))
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.secondaryText)
                        .lineLimit(1)
                        .fixedSize()
                }
                Text(entry.text)
                    .font(QuaiFont.subheadline)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
