import Foundation

/// What the console's QR code holds:
/// `quai://pair?code=ABCD2345&url=http://umbrel.local:3078&url=…&header=CF-Access-Client-Id%3A%20…`.
/// `header` items are the access headers of the proxy in front of Quai Cloud (`QUAI_PUBLIC_HEADERS`).
/// `console` is where the console that showed the code was open: Quai Home's, not Quai Cloud's.
struct PairingLink: Equatable {
    var code: String
    var serverURLs: [URL]
    var accessHeaders: [AccessHeader]
    var consoleURL: URL?

    init(code: String, serverURLs: [URL], accessHeaders: [AccessHeader] = [], consoleURL: URL? = nil) {
        self.code = code
        self.serverURLs = serverURLs
        self.accessHeaders = accessHeaders
        self.consoleURL = consoleURL
    }

    init?(_ url: URL) {
        guard url.scheme == "quai", url.host() == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
        else { return nil }
        self.code = code
        serverURLs = items.filter { $0.name == "url" }.compactMap { $0.value.flatMap(URL.init(string:)) }
        accessHeaders = items.filter { $0.name == "header" }.compactMap { $0.value.flatMap(AccessHeader.init(pair:)) }
        consoleURL = items.first(where: { $0.name == "console" })?.value
            .flatMap(URL.init(string:))
            .flatMap { url in url.scheme == "http" || url.scheme == "https" ? url : nil }
    }
}
