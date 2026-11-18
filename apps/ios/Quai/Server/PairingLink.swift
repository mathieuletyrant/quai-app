import Foundation

/// What the console's QR code holds: `quai://pair?code=ABCD2345&url=http://umbrel.local:3078&url=…`.
struct PairingLink: Equatable {
    var code: String
    var serverURLs: [URL]

    init(code: String, serverURLs: [URL]) {
        self.code = code
        self.serverURLs = serverURLs
    }

    init?(_ url: URL) {
        guard url.scheme == "quai", url.host() == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
        else { return nil }
        self.code = code
        serverURLs = items.filter { $0.name == "url" }.compactMap { $0.value.flatMap(URL.init(string:)) }
    }
}
