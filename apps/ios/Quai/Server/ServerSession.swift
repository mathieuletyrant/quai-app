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
    /// Quai Home's console: where the pairing code was shown, then its public address.
    var consoleURLs: [URL] = []

    private static let tokenAccount = "deviceToken"
    private static let accessHeadersAccount = "accessHeaders"
    private static let urlsKey = "serverURLs"
    private static let consoleKey = "consoleURLs"

    static func stored() -> ServerSession? {
        guard let token = Keychain.read(tokenAccount) else { return nil }
        let urls = (UserDefaults.standard.stringArray(forKey: urlsKey) ?? []).compactMap(URL.init(string:))
        let headers = Keychain.read(accessHeadersAccount)
            .flatMap { try? JSONDecoder().decode([AccessHeader].self, from: Data($0.utf8)) } ?? []
        let console = (UserDefaults.standard.stringArray(forKey: consoleKey) ?? []).compactMap(URL.init(string:))
        return urls.isEmpty ? nil : ServerSession(token: token, urls: urls, accessHeaders: headers, consoleURLs: console)
    }

    func save() {
        Keychain.write(token, for: Self.tokenAccount)
        if accessHeaders.isEmpty {
            Keychain.delete(Self.accessHeadersAccount)
        } else if let data = try? JSONEncoder().encode(accessHeaders), let json = String(data: data, encoding: .utf8) {
            Keychain.write(json, for: Self.accessHeadersAccount)
        }
        UserDefaults.standard.set(urls.map(\.absoluteString), forKey: Self.urlsKey)
        UserDefaults.standard.set(consoleURLs.map(\.absoluteString), forKey: Self.consoleKey)
    }

    static func clear() {
        Keychain.delete(tokenAccount)
        Keychain.delete(accessHeadersAccount)
        UserDefaults.standard.removeObject(forKey: urlsKey)
        UserDefaults.standard.removeObject(forKey: consoleKey)
    }

    /// An authenticated client on the first address that answers. Throws
    /// `ConnectionError.blockedByProxy` when only a proxy answered, `.unreachable` otherwise.
    func connect() async throws -> (url: URL, client: Client) {
        let url = try await Self.firstReachable(urls, accessHeaders: accessHeaders)
        let middlewares: [any ClientMiddleware] = [
            QuaiErrorsMiddleware(),
            AccessHeadersMiddleware(headers: accessHeaders),
            BearerMiddleware(token: token),
        ]
        return (url, Client(serverURL: url, transport: URLSessionTransport(), middlewares: middlewares))
    }

    /// What pairing keeps: the code's addresses in its order, at home first, plus the one that
    /// answered when the code didn't list it.
    static func pairedURLs(_ listed: [URL], answered: URL) -> [URL] {
        listed.contains(answered) ? listed : [answered] + listed
    }

    /// Quai answers at the first of several addresses, the one at home. With a single address the
    /// app can't tell: it counts as away.
    static func isAtHome(_ current: URL?, in urls: [URL]) -> Bool {
        urls.count > 1 && current == urls.first
    }

    static func firstReachable(_ urls: [URL], accessHeaders: [AccessHeader]) async throws -> URL {
        try await firstReachable(urls) { url in await probe(url, accessHeaders: accessHeaders) }
    }

    /// Every address is asked at once, and the first to answer wins: away from home the local one
    /// only fails at its timeout, so asking one after the other said "Can't reach" before the
    /// public one had its turn. At home the local one answers first.
    static func firstReachable(_ urls: [URL], probe: @escaping @Sendable (URL) async -> Probe) async throws -> URL {
        let (reached, blocked) = await withTaskGroup(of: (URL, Probe).self) { group in
            for url in urls {
                group.addTask { await (url, probe(url)) }
            }
            var blocked = false
            for await (url, answer) in group {
                switch answer {
                case .reachable:
                    group.cancelAll()
                    return (Optional(url), blocked)
                case .blocked: blocked = true
                case .unreachable: continue
                }
            }
            return (nil, blocked)
        }
        if let reached { return reached }
        throw blocked ? ConnectionError.blockedByProxy : ConnectionError.unreachable
    }

    enum Probe: Sendable { case reachable, blocked, unreachable }

    /// The console address to open: the first one that answers (the local one, at home), else the
    /// last one (the public one, behind the user's own proxy and its sign-in).
    static func consoleToOpen(_ urls: [URL], answers: @Sendable (URL) async -> Bool) async -> URL? {
        for url in urls.dropLast() where await answers(url) { return url }
        return urls.last
    }

    /// Whether anything answers at this address within 3 s. Any HTTP answer counts: a proxy's
    /// sign-in page is the console's door too.
    static func answers(_ url: URL) async -> Bool {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        let response = try? await URLSession(configuration: configuration).data(for: request).1
        return response is HTTPURLResponse
    }

    /// 10 s: on mobile data, the first request through a tunnel (DNS, TLS, the proxy) can take
    /// more than a few seconds.
    private static let probeTimeout: TimeInterval = 10

    private static func probe(_ url: URL, accessHeaders: [AccessHeader]) async -> Probe {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = probeTimeout
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
