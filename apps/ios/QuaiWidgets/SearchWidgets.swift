import AppIntents
import SwiftUI
import WidgetKit

/// The Lock Screen control (also in Control Center and on the Action button): opens Quai's search
/// already listening, to say a title.
struct SearchControl: ControlWidget {
    static let kind = "com.mathieuletyrant.quai.search-control"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenSearchIntent(listen: true)) {
                Label("Search Seerr", systemImage: "waveform.and.magnifyingglass")
            }
        }
        .displayName("Search Seerr")
        .description("Opens Quai's search, listening: say a movie or a series.")
    }
}

/// The Lock Screen widget: opens Quai's search with the keyboard up.
struct SearchWidget: Widget {
    static let kind = "com.mathieuletyrant.quai.search"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: SearchWidgetTimeline()) { _ in
            SearchWidgetView()
        }
        .configurationDisplayName("Search Seerr")
        .description("Opens Quai's search to request a movie or a series.")
        .supportedFamilies([.accessoryCircular, .accessoryInline])
    }
}

struct SearchWidgetEntry: TimelineEntry {
    let date: Date
}

/// Nothing changes: one entry, never refreshed.
struct SearchWidgetTimeline: TimelineProvider {
    func placeholder(in context: Context) -> SearchWidgetEntry { SearchWidgetEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (SearchWidgetEntry) -> Void) {
        completion(SearchWidgetEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SearchWidgetEntry>) -> Void) {
        completion(Timeline(entries: [SearchWidgetEntry(date: .now)], policy: .never))
    }
}

struct SearchWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if family == .accessoryInline {
                Label("Search Seerr", systemImage: "magnifyingglass")
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 22, weight: .semibold))
                }
                .accessibilityLabel("Search Seerr")
            }
        }
        .widgetURL(SearchLink.url(listen: false))
        .containerBackground(for: .widget) { Color.clear }
    }
}
