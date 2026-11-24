import AppIntents
import Foundation

/// Opens Quai's search: the Lock Screen control, Control Center, the Action button and Shortcuts
/// run it. `listen` opens it already listening, for a title said out loud.
struct OpenSearchIntent: AppIntent {
    static let title: LocalizedStringResource = "Search in Quai"
    static let description = IntentDescription("Finds a movie or a series in Seerr, to request it.")
    static let openAppWhenRun = true

    @Parameter(title: "Dictate", default: true) var listen: Bool

    init() {}

    init(listen: Bool) {
        self.listen = listen
    }

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(SearchLink.url(listen: listen)))
    }
}
