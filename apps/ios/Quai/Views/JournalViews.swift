import SwiftUI

typealias JournalEntry = Components.Schemas.JournalEntry

extension JournalEntry {
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
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

/// One line of the journal: what happened, over who it's about and when.
struct JournalRow: View {
    let entry: JournalEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(entry.text)
                .font(QuaiFont.subheadline)
                .foregroundStyle(Palette.primaryText)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            ServiceLine(
                services: [entry.source.rawValue],
                detail: Text(entry.date, format: .relative(presentation: .named, unitsStyle: .narrow))
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
