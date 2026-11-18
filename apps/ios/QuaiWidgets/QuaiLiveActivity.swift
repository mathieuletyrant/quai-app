import ActivityKit
import SwiftUI
import WidgetKit

/// Everything the views need, computed once from the server's description.
struct Model {
    let attributes: QuaiActivityAttributes
    let state: QuaiActivityAttributes.ContentState

    var step: QuaiActivityAttributes.Step? {
        attributes.steps.indices.contains(state.step) ? attributes.steps[state.step] : attributes.steps.last
    }

    var tint: Color { Palette.tint(tone: state.tone.rawValue, color: attributes.color) }

    var symbol: String { state.tone == .done ? "checkmark" : (step?.icon ?? attributes.icon) }

    var endsAt: Date? { state.endsAt.map { Date(timeIntervalSince1970: $0) } }
    var paused: Bool { state.paused == true }

    /// The playback timeline, when it runs: the bar animates on its own between these dates.
    var timeline: ClosedRange<Date>? {
        guard !paused, let start = state.startsAt, let end = state.endsAt, end > start else { return nil }
        return Date(timeIntervalSince1970: start)...Date(timeIntervalSince1970: end)
    }

    var actions: [ActivityAction] {
        guard state.tone != .done else { return [] }
        return (step?.actions ?? []).compactMap(ActivityAction.init(rawValue:))
    }
    var since: Date? { state.since.map { Date(timeIntervalSince1970: $0) } }

    /// "Downloading · ≈ 4 min · 11 MB/s", "Playing · TV Salon"
    var subtitle: String {
        var parts = [state.tone == .stalled ? "No progress for a while" : paused ? "Paused" : (step?.label ?? "")]
        if let remaining = state.remainingSeconds { parts.append("≈ " + Self.duration(remaining)) }
        if let speed = state.bytesPerSecond, speed > 0 {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(speed), countStyle: .file) + "/s")
        }
        if let detail = state.detail { parts.append(detail) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func duration(_ seconds: Double) -> String {
        if seconds < 60 { return "< 1 min" }
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        formatter.unitsStyle = .abbreviated
        return formatter.string(from: seconds) ?? ""
    }
}

struct QuaiLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: QuaiActivityAttributes.self) { context in
            let model = Model(attributes: context.attributes, state: context.state)
            LockScreenBanner(model: model)
                .padding(16)
                .activityBackgroundTint(Color(red: 0.04, green: 0.04, blue: 0.06).opacity(0.92))
                .activitySystemActionForegroundColor(model.tint)
        } dynamicIsland: { context in
            let model = Model(attributes: context.attributes, state: context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    GlyphTile(model: model, size: 44).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Headline(model: model).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title).font(.headline).lineLimit(1)
                        Text(model.subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        Timeline(model: model)
                        if model.attributes.steps.count > 1 { Stepper(model: model) }
                        if !model.actions.isEmpty { ActionButtons(model: model) }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Ring(model: model, size: 18, lineWidth: 3)
            } compactTrailing: {
                CompactValue(model: model)
            } minimal: {
                Ring(model: model, size: 20, lineWidth: 3)
            }
            .keylineTint(model.tint)
        }
    }
}

/// Lock Screen banner, as in the mockups: glyph tile, title and status, headline value, bar, steps.
struct LockScreenBanner: View {
    let model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                GlyphTile(model: model, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.attributes.title).font(.headline).lineLimit(1)
                    Text(model.subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                }
                Spacer(minLength: 8)
                Headline(model: model)
            }
            Timeline(model: model)
            if model.attributes.steps.count > 1 { Stepper(model: model) }
            if !model.actions.isEmpty { ActionButtons(model: model) }
        }
        .foregroundStyle(.white)
    }
}

struct GlyphTile: View {
    let model: Model
    let size: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(Color.black)
            .overlay {
                Image(systemName: model.symbol)
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(model.tint)
            }
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).strokeBorder(.white.opacity(0.08))
            }
            .frame(width: size, height: size)
    }
}

/// The big value on the right: percent, countdown, time since, or a check when done.
struct Headline: View {
    let model: Model

    var body: some View {
        Group {
            if model.state.tone == .done {
                Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Palette.ready)
            } else if model.paused {
                Image(systemName: "pause.circle.fill").font(.title2)
            } else if let progress = model.state.progress {
                Text(progress, format: .percent.precision(.fractionLength(0)))
                    .contentTransition(.numericText(value: progress))
            } else if let endsAt = model.endsAt, endsAt > .now {
                Text(timerInterval: Date.now...endsAt, countsDown: true).frame(maxWidth: 90, alignment: .trailing)
            } else if let since = model.since {
                Text(timerInterval: since...Date.distantFuture, countsDown: false).frame(maxWidth: 90, alignment: .trailing)
            }
        }
        .font(.title2.monospacedDigit().weight(.bold))
        .foregroundStyle(model.tint)
        .multilineTextAlignment(.trailing)
    }
}

struct CompactValue: View {
    let model: Model

    var body: some View {
        Group {
            if let progress = model.state.progress, model.state.tone != .done {
                Text(progress, format: .percent.precision(.fractionLength(0)))
            } else if let endsAt = model.endsAt, endsAt > .now, model.state.tone != .done {
                Text(timerInterval: Date.now...endsAt, countsDown: true).frame(maxWidth: 52)
            } else {
                Image(systemName: model.symbol)
            }
        }
        .font(.caption.monospacedDigit().weight(.semibold))
        .foregroundStyle(model.tint)
    }
}

/// Download progress pushed by the server, or a playback timeline the iPhone animates itself.
struct Timeline: View {
    let model: Model

    var body: some View {
        if let timeline = model.timeline {
            ProgressView(timerInterval: timeline, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .progressViewStyle(.linear)
            .tint(model.tint)
        } else if let progress = model.state.progress {
            ProgressBar(value: progress, tint: model.tint)
        }
    }
}

/// The step's buttons, run by `ActivityActionIntent` without opening the app.
struct ActionButtons: View {
    let model: Model

    var body: some View {
        HStack(spacing: 10) {
            ForEach(model.actions, id: \.self) { action in
                Button(intent: ActivityActionIntent(key: model.attributes.key, action: action)) {
                    Image(systemName: action.symbol(paused: model.paused))
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.plain)
                .foregroundStyle(model.tint)
                .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityLabel(action.label)
            }
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

/// This iPhone's steps: done ones filled, the current one tinted, the rest dim.
struct Stepper: View {
    let model: Model

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(model.attributes.steps.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 4) {
                    Capsule().fill(index <= model.state.step ? model.tint : Palette.track).frame(height: 3)
                    Text(step.label)
                        .font(.caption2.weight(index == model.state.step ? .semibold : .regular))
                        .foregroundStyle(.white.opacity(index == model.state.step ? 0.95 : 0.5))
                        .lineLimit(1)
                }
            }
        }
    }
}

/// Progress ring for the Dynamic Island, like the StandBy mockup: download progress, or how far
/// along the steps the activity is.
struct Ring: View {
    let model: Model
    let size: CGFloat
    let lineWidth: CGFloat

    var body: some View {
        let steps = max(model.attributes.steps.count - 1, 1)
        let value = model.state.tone == .done ? 1 : (model.state.progress ?? max(Double(model.state.step) / Double(steps), 0.08))
        ZStack {
            Circle().stroke(Palette.track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: value)
                .stroke(model.tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: model.symbol).font(.system(size: size * 0.42, weight: .heavy)).foregroundStyle(model.tint)
        }
        .frame(width: size, height: size)
    }
}
