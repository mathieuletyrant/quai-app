import ActivityKit
import SwiftUI
import WidgetKit

struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            // Lock Screen banner
            VStack(alignment: .leading, spacing: 6) {
                Text(context.attributes.title).font(.headline)
                StepLabel(state: context.state)
                if let progress = context.state.progress {
                    ProgressView(value: progress)
                }
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "arrow.down.circle") }
                DynamicIslandExpandedRegion(.center) { Text(context.attributes.title).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) { StepLabel(state: context.state) }
            } compactLeading: {
                Image(systemName: "arrow.down.circle")
            } compactTrailing: {
                if let progress = context.state.progress {
                    Text(progress, format: .percent.precision(.fractionLength(0)))
                }
            } minimal: {
                Image(systemName: "arrow.down.circle")
            }
        }
    }
}

private struct StepLabel: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        Text(label).font(.subheadline).foregroundStyle(state.stalled ? .secondary : .primary)
    }

    private var label: String {
        if state.stalled { return "No source · Other release" }
        switch state.step {
        case .searching: return "Searching"
        case .downloading: return "Downloading"
        case .importing: return "Importing"
        case .subtitles: return "French subtitles"
        case .available: return "Available"
        }
    }
}
