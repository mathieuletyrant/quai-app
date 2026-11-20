import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// What pairing stored, and how to reach the server with it. Plain value: the UI's `Connection`
/// and the Live Activity buttons (App Intents, which may run with no UI) both use it.
struct ServerSession: Sendable, Equatable {
    var token: String
    /// Local address first, then public ones (behind a reverse proxy, say).
    var urls: [URL]
    /// What the proxy in front of the public address requires. Sent to every address: the local
    /// one ignores them, and it is trusted with the device token already, a bigger secret.
    var accessHeaders: [AccessHeader] = []

    private static let tokenAccount = "deviceToken"
    private static let accessHeadersAccount = "accessHeaders"
    private static let urlsKey = "serverURLs"

    static func stored() -> ServerSession? {
        guard let token = Keychain.read(tokenAccount) else { return nil }
        let urls = (UserDefaults.standard.stringArray(forKey: urlsKey) ?? []).compactMap(URL.init(string:))
        let headers = Keychain.read(accessHeadersAccount)
            .flatMap { try? JSONDecoder().decode([AccessHeader].self, from: Data($0.utf8)) } ?? []
        return urls.isEmpty ? nil : ServerSession(token: token, urls: urls, accessHeaders: headers)
    }

    func save() {
        Keychain.write(token, for: Self.tokenAccount)
        if accessHeaders.isEmpty {
            Keychain.delete(Self.accessHeadersAccount)
        } else if let data = try? JSONEncoder().encode(accessHeaders), let json = String(data: data, encoding: .utf8) {
            Keychain.write(json, for: Self.accessHeadersAccount)
        }
        UserDefaults.standard.set(urls.map(\.absoluteString), forKey: Self.urlsKey)
    }

    static func clear() {
        Keychain.delete(tokenAccount)
        Keychain.delete(accessHeadersAccount)
        UserDefaults.standard.removeObject(forKey: urlsKey)
    }

    /// An authenticated client on the first address that answers, `preferred` first. Throws
    /// `ConnectionError.blockedByProxy` when only a proxy answered, `.unreachable` otherwise.
    func connect(preferring preferred: URL? = nil) async throws -> (url: URL, client: Client) {
        let ordered = (preferred.map { [$0] } ?? []) + urls.filter { $0 != preferred }
        let url = try await Self.firstReachable(ordered, accessHeaders: accessHeaders)
        let middlewares: [any ClientMiddleware] = [
            QuaiErrorsMiddleware(),
            AccessHeadersMiddleware(headers: accessHeaders),
            BearerMiddleware(token: token),
        ]
        return (url, Client(serverURL: url, transport: URLSessionTransport(), middlewares: middlewares))
    }

    static func firstReachable(_ urls: [URL], accessHeaders: [AccessHeader]) async throws -> URL {
        var blocked = false
        for url in urls {
            switch await probe(url, accessHeaders: accessHeaders) {
            case .reachable: return url
            case .blocked: blocked = true
            case .unreachable: continue
            }
        }
        throw blocked ? ConnectionError.blockedByProxy : ConnectionError.unreachable
    }

    private enum Probe { case reachable, blocked, unreachable }

    private static func probe(_ url: URL, accessHeaders: [AccessHeader]) async -> Probe {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        let transport = URLSessionTransport(configuration: .init(session: URLSession(configuration: configuration)))
        let client = Client(serverURL: url, transport: transport, middlewares: [AccessHeadersMiddleware(headers: accessHeaders)])
        do {
            guard case .ok = try await client.getHealth() else { return .unreachable }
            return .reachable
        } catch {
            return error.isBlockedByProxy ? .blocked : .unreachable
        }
    }
}
