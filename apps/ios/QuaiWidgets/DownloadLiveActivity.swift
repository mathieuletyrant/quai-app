import ActivityKit
import SwiftUI
import WidgetKit

/// Colors from the mockups: amber for downloads, teal accent, green when ready.
enum Palette {
    static let download = Color(red: 1, green: 0xC2 / 255, blue: 0x30 / 255)
    static let ready = Color(red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255)
    static let stalled = Color(white: 0.55)
    static let tile = Color.black
    static let track = Color.white.opacity(0.14)
}

extension DownloadActivityAttributes.ContentState {
    var tint: Color {
        if stalled { return Palette.stalled }
        return step == .available ? Palette.ready : Palette.download
    }

    /// 0...1 across the whole journey when not downloading, the torrent's progress while it is.
    var shownProgress: Double? {
        step == .downloading ? (progress ?? 0) : nil
    }

    var symbol: String {
        switch step {
        case .searching: "magnifyingglass"
        case .downloading: "arrow.down"
        case .importing: "tray.and.arrow.down.fill"
        case .available: "checkmark"
        }
    }

    var headline: String {
        if stalled { return "No source for 2 h" }
        switch step {
        case .searching: return "Searching"
        case .downloading: return "Downloading"
        case .importing: return "Importing"
        case .available: return "Ready to watch"
        }
    }

    /// "≈ 2 min · 9.4 MB/s"
    var detail: String? {
        if stalled { return "Try another release" }
        guard step == .downloading else { return nil }
        var parts: [String] = []
        if let remaining = remainingSeconds { parts.append("≈ " + Self.duration(remaining)) }
        if let speed = bytesPerSecond, speed > 0 {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(speed), countStyle: .file) + "/s")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func duration(_ seconds: Double) -> String {
        if seconds < 60 { return "< 1 min" }
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        formatter.unitsStyle = .abbreviated
        return formatter.string(from: seconds) ?? ""
    }
}

struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            LockScreenBanner(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color(red: 0.04, green: 0.04, blue: 0.06).opacity(0.92))
                .activitySystemActionForegroundColor(context.state.tint)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    GlyphTile(state: state, size: 44).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    BigPercent(state: state).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title).font(.headline).lineLimit(1)
                        Subtitle(state: state)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        if let progress = state.shownProgress { ProgressBar(value: progress, tint: state.tint) }
                        Stepper(steps: context.attributes.shownSteps, current: state.step, tint: state.tint)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Ring(state: state, size: 18, lineWidth: 3)
            } compactTrailing: {
                if let progress = state.shownProgress {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(state.tint)
                } else {
                    Image(systemName: state.symbol).foregroundStyle(state.tint)
                }
            } minimal: {
                Ring(state: state, size: 20, lineWidth: 3)
            }
            .keylineTint(state.tint)
        }
    }
}

/// Lock Screen banner, as in the mockups: glyph tile, title and status, big percent, bar, steps.
struct LockScreenBanner: View {
    let attributes: DownloadActivityAttributes
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                GlyphTile(state: state, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(attributes.title).font(.headline).lineLimit(1)
                    Subtitle(state: state)
                }
                Spacer(minLength: 8)
                BigPercent(state: state)
            }
            if let progress = state.shownProgress { ProgressBar(value: progress, tint: state.tint) }
            Stepper(steps: attributes.shownSteps, current: state.step, tint: state.tint)
        }
        .foregroundStyle(.white)
    }
}

struct GlyphTile: View {
    let state: DownloadActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(Palette.tile)
            .overlay {
                Image(systemName: state.symbol)
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(state.tint)
            }
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                    .strokeBorder(.white.opacity(0.08))
            }
            .frame(width: size, height: size)
    }
}

struct Subtitle: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        Text([state.headline, state.detail].compactMap { $0 }.joined(separator: " · "))
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.65))
            .lineLimit(1)
    }
}

struct BigPercent: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        if let progress = state.shownProgress {
            Text(progress, format: .percent.precision(.fractionLength(0)))
                .font(.title2.monospacedDigit().weight(.bold))
                .foregroundStyle(state.tint)
                .contentTransition(.numericText(value: progress))
        } else if state.step == .available {
            Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Palette.ready)
        }
    }
}

struct ProgressBar: View {
    let value: Double
    let tint: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.track)
                Capsule().fill(tint).frame(width: max(6, proxy.size.width * min(max(value, 0), 1)))
            }
        }
        .frame(height: 6)
    }
}

/// The steps this iPhone shows: done ones filled, the current one tinted, the rest dim.
struct Stepper: View {
    let steps: [DownloadActivityAttributes.Step]
    let current: DownloadActivityAttributes.Step
    let tint: Color

    var body: some View {
        let order = DownloadActivityAttributes.Step.allCases
        let rank = { (step: DownloadActivityAttributes.Step) in order.firstIndex(of: step) ?? 0 }
        // The current step, or the last shown step before it when the current one is hidden.
        let currentIndex = steps.lastIndex { rank($0) <= rank(current) } ?? 0
        HStack(spacing: 6) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 4) {
                    Capsule()
                        .fill(index <= currentIndex ? tint : Palette.track)
                        .frame(height: 3)
                    Text(Self.label(step))
                        .font(.caption2.weight(index == currentIndex ? .semibold : .regular))
                        .foregroundStyle(.white.opacity(index == currentIndex ? 0.95 : 0.5))
                        .lineLimit(1)
                }
            }
        }
    }

    static func label(_ step: DownloadActivityAttributes.Step) -> String {
        switch step {
        case .searching: "Search"
        case .downloading: "Download"
        case .importing: "Import"
        case .available: "Ready"
        }
    }
}

/// Progress ring for the Dynamic Island, like the StandBy mockup.
struct Ring: View {
    let state: DownloadActivityAttributes.ContentState
    let size: CGFloat
    let lineWidth: CGFloat

    var body: some View {
        let value: Double = switch state.step {
        case .searching: 0.08
        case .downloading: max(state.progress ?? 0, 0.04)
        case .importing, .available: 1
        }
        ZStack {
            Circle().stroke(Palette.track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: value)
                .stroke(state.tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if state.step == .available {
                Image(systemName: "checkmark").font(.system(size: size * 0.45, weight: .heavy)).foregroundStyle(state.tint)
            }
        }
        .frame(width: size, height: size)
    }
}
