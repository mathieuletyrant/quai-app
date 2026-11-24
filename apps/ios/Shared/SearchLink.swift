import Foundation

/// `quai://search`, opened by the Lock Screen widget, and `quai://search?listen=1` by the control:
/// the Search tab, the keyboard up or already listening.
struct SearchLink: Equatable {
    var listen: Bool
    /// Tells two taps on the same link apart, so the second one opens the search again.
    var id = UUID()

    init(listen: Bool) {
        self.listen = listen
    }

    init?(_ url: URL) {
        guard url.scheme == "quai", url.host() == "search" else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        listen = items.contains { $0.name == "listen" && $0.value == "1" }
    }

    static func url(listen: Bool) -> URL {
        URL(string: listen ? "quai://search?listen=1" : "quai://search")!
    }
}
