import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// What pairing stored, and how to reach the server with it. Plain value: the UI's `Connection`
/// and the Live Activity buttons (App Intents, which may run with no UI) both use it.
struct ServerSession: Sendable, Equatable {
    var token: String
    /// Local address first, then public ones (behind Cloudflare Access, say).
    var urls: [URL]

    private static let tokenAccount = "deviceToken"
    private static let urlsKey = "serverURLs"

    static func stored() -> ServerSession? {
        guard let token = Keychain.read(tokenAccount) else { return nil }
        let urls = (UserDefaults.standard.stringArray(forKey: urlsKey) ?? []).compactMap(URL.init(string:))
        return urls.isEmpty ? nil : ServerSession(token: token, urls: urls)
    }

    func save() {
        Keychain.write(token, for: Self.tokenAccount)
        UserDefaults.standard.set(urls.map(\.absoluteString), forKey: Self.urlsKey)
    }

    static func clear() {
        Keychain.delete(tokenAccount)
        UserDefaults.standard.removeObject(forKey: urlsKey)
    }

    /// An authenticated client on the first address that answers, `preferred` first.
    func connect(preferring preferred: URL? = nil) async -> (url: URL, client: Client)? {
        let ordered = (preferred.map { [$0] } ?? []) + urls.filter { $0 != preferred }
        guard let url = await Self.firstReachable(ordered) else { return nil }
        return (url, Client(serverURL: url, transport: URLSessionTransport(), middlewares: [BearerMiddleware(token: token)]))
    }

    static func firstReachable(_ urls: [URL]) async -> URL? {
        for url in urls where await isReachable(url) { return url }
        return nil
    }

    private static func isReachable(_ url: URL) async -> Bool {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        let transport = URLSessionTransport(configuration: .init(session: URLSession(configuration: configuration)))
        guard let response = try? await Client(serverURL: url, transport: transport).getHealth(), case .ok = response else {
            return false
        }
        return true
    }
}
