import AppIntents

/// What Siri and the Shortcuts app offer without any setup: "Search in Quai".
struct QuaiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenSearchIntent(listen: true),
            phrases: ["Search in \(.applicationName)", "Request a movie in \(.applicationName)"],
            shortTitle: "Search Seerr",
            systemImageName: "magnifyingglass"
        )
    }
}
