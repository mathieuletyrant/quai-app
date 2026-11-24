import Foundation

/// What the console's QR code holds:
/// `quai://pair?code=ABCD2345&url=http://umbrel.local:3078&url=…&header=CF-Access-Client-Id%3A%20…`.
/// `header` items are the access headers of the proxy in front of Quai Cloud (`QUAI_CLOUD_PUBLIC_HEADERS`).
/// `console` items are Quai Home's console: where it was open when it showed the code, then its
/// public address (`QUAI_CONSOLE_PUBLIC_URL`) when it's another.
struct PairingLink: Equatable {
    var code: String
    var serverURLs: [URL]
    var accessHeaders: [AccessHeader]
    var consoleURLs: [URL]

    init(code: String, serverURLs: [URL], accessHeaders: [AccessHeader] = [], consoleURLs: [URL] = []) {
        self.code = code
        self.serverURLs = serverURLs
        self.accessHeaders = accessHeaders
        self.consoleURLs = consoleURLs
    }

    init?(_ url: URL) {
        guard url.scheme == "quai", url.host() == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
        else { return nil }
        self.code = code
        serverURLs = items.filter { $0.name == "url" }.compactMap { $0.value.flatMap(URL.init(string:)) }
        accessHeaders = items.filter { $0.name == "header" }.compactMap { $0.value.flatMap(AccessHeader.init(pair:)) }
        consoleURLs = items.filter { $0.name == "console" }
            .compactMap { $0.value.flatMap(URL.init(string:)) }
            .filter { $0.scheme == "http" || $0.scheme == "https" }
    }
}
