import ActivityKit
import SwiftUI
import WidgetKit

private let accent = Color(red: 0x6F / 255, green: 0xD3 / 255, blue: 0xC2 / 255)

struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            LockScreenView(title: context.attributes.title, state: context.state)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(accent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StepIcon(state: context.state).font(.title2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let progress = context.state.progress, context.state.step == .downloading {
                        Text(progress, format: .percent.precision(.fractionLength(0)))
                            .font(.title3.monospacedDigit().bold())
                            .foregroundStyle(accent)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        if let progress = context.state.progress, context.state.step == .downloading {
                            ProgressView(value: progress).tint(context.state.stalled ? .gray : accent)
                        }
                        StepLabel(state: context.state)
                    }
                }
            } compactLeading: {
                StepIcon(state: context.state)
            } compactTrailing: {
                if let progress = context.state.progress, context.state.step == .downloading {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                        .monospacedDigit()
                        .foregroundStyle(context.state.stalled ? .gray : accent)
                } else {
                    StepIcon(state: context.state)
                }
            } minimal: {
                StepIcon(state: context.state)
            }
            .keylineTint(accent)
        }
    }
}

struct LockScreenView: View {
    let title: String
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                StepIcon(state: state)
                Text(title).font(.headline).lineLimit(1)
                Spacer()
                if let progress = state.progress, state.step == .downloading {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(state.stalled ? .gray : accent)
                }
            }
            if let progress = state.progress, state.step == .downloading {
                ProgressView(value: progress).tint(state.stalled ? .gray : accent)
            }
            StepLabel(state: state)
        }
    }
}

struct StepIcon: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        Image(systemName: symbol)
            .foregroundStyle(state.stalled ? .gray : accent)
    }

    private var symbol: String {
        switch state.step {
        case .searching: "magnifyingglass"
        case .downloading: "arrow.down.circle"
        case .importing: "tray.and.arrow.down"
        case .available: "checkmark.circle.fill"
        }
    }
}

struct StepLabel: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        Text(label)
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    private var label: String {
        if state.stalled { return "No source for 2 h · Other release" }
        switch state.step {
        case .searching: return "Searching for a release"
        case .downloading:
            var parts = ["Downloading"]
            if let speed = state.bytesPerSecond, speed > 0 {
                parts.append(ByteCountFormatter.string(fromByteCount: Int64(speed), countStyle: .file) + "/s")
            }
            if let remaining = state.remainingSeconds {
                let formatter = DateComponentsFormatter()
                formatter.allowedUnits = remaining >= 3600 ? [.hour, .minute] : [.minute]
                formatter.unitsStyle = .abbreviated
                if let text = formatter.string(from: remaining) { parts.append("\(text) left") }
            }
            return parts.joined(separator: " · ")
        case .importing: return "Importing"
        case .available: return "Ready to watch"
        }
    }
}
