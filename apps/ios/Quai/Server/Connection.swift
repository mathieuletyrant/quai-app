import ActivityKit
import Foundation
import Observation
import OpenAPIRuntime
import OpenAPIURLSession

enum ConnectionError: LocalizedError {
    case unreachable
    case invalidCode
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .unreachable: "Can't reach the Quai server. On Wi-Fi at home, or check the address."
        case .invalidCode: "This code is unknown, already used or expired. Show a new one in the console."
        case let .server(status): "The server answered \(status)."
        }
    }
}

/// The link between this iPhone and its Quai server: pairing, tokens, and the running activities.
@MainActor @Observable
final class Connection {
    private(set) var serverURL: URL?
    private(set) var activities: [Components.Schemas.RunningActivity] = []
    private(set) var lastError: String?
    private var serverURLs: [URL] = []
    private var token: String?
    /// Arrives from ActivityKit at any time, before or after pairing.
    private var pushToStartToken: String?

    var isPaired: Bool { token != nil && !serverURLs.isEmpty }

    /// Builds from Xcode reach APNs development; TestFlight and the App Store, production.
    static var apnsEnvironment: Components.Schemas.ApnsEnvironment {
        #if DEBUG
            .development
        #else
            .production
        #endif
    }

    init() {
        token = Keychain.read("deviceToken")
        serverURLs = (UserDefaults.standard.stringArray(forKey: "serverURLs") ?? []).compactMap(URL.init(string:))
        serverURL = serverURLs.first
    }

    // MARK: Pairing

    func pair(_ link: PairingLink, name: String) async throws {
        guard let url = await firstReachable(link.serverURLs) else { throw ConnectionError.unreachable }
        let client = Client(serverURL: url, transport: URLSessionTransport())
        let body = Components.Schemas.PairDevice(
            code: link.code,
            name: name,
            apnsEnvironment: Self.apnsEnvironment,
            pushToStartToken: pushToStartToken
        )
        switch try await client.pairDevice(body: .json(body)) {
        case let .ok(ok):
            let paired = try ok.body.json
            Keychain.write(paired.token, for: "deviceToken")
            token = paired.token
            serverURLs = [url] + link.serverURLs.filter { $0 != url }
            serverURL = url
            UserDefaults.standard.set(serverURLs.map(\.absoluteString), forKey: "serverURLs")
            lastError = nil
            await refresh()
        case .forbidden:
            throw ConnectionError.invalidCode
        case let .undocumented(statusCode, _):
            throw ConnectionError.server(statusCode)
        }
    }

    func disconnect() {
        Keychain.delete("deviceToken")
        UserDefaults.standard.removeObject(forKey: "serverURLs")
        token = nil
        serverURLs = []
        serverURL = nil
        activities = []
    }

    // MARK: Activities

    func refresh() async {
        guard let client = await authenticatedClient() else { return }
        do {
            switch try await client.listActivities() {
            case let .ok(ok):
                activities = try ok.body.json
                lastError = nil
            case .unauthorized:
                lastError = "This iPhone was removed from the console. Pair it again."
            case let .undocumented(statusCode, _):
                lastError = ConnectionError.server(statusCode).localizedDescription
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Follows ActivityKit's tokens for as long as the app runs: the push-to-start token, and the
    /// push token of every Download activity, including the ones the server started remotely.
    func watchTokens() async {
        for activity in Activity<DownloadActivityAttributes>.activities {
            Task { await watch(activity) }
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                for await data in Activity<DownloadActivityAttributes>.pushToStartTokenUpdates {
                    await self.didReceivePushToStartToken(data.hexString)
                }
            }
            group.addTask { @MainActor in
                for await activity in Activity<DownloadActivityAttributes>.activityUpdates {
                    Task { await self.watch(activity) }
                }
            }
        }
    }

    private func didReceivePushToStartToken(_ hex: String) async {
        pushToStartToken = hex
        await send { client in
            _ = try await client.updateDevice(body: .json(.init(pushToStartToken: hex)))
        }
    }

    private func watch(_ activity: Activity<DownloadActivityAttributes>) async {
        let mediaKey = activity.attributes.mediaKey
        for await data in activity.pushTokenUpdates {
            let hex = data.hexString
            await send { client in
                _ = try await client.reportActivityToken(body: .json(.init(mediaKey: mediaKey, pushToken: hex)))
            }
        }
    }

    // MARK: Plumbing

    private func send(_ call: (Client) async throws -> Void) async {
        guard let client = await authenticatedClient() else { return }
        do { try await call(client) } catch { lastError = error.localizedDescription }
    }

    /// Prefers the address that answered last; on another network, tries the others (local, then public).
    private func authenticatedClient() async -> Client? {
        guard let token, !serverURLs.isEmpty else { return nil }
        let url: URL
        if let current = serverURL, await isReachable(current) {
            url = current
        } else if let other = await firstReachable(serverURLs) {
            url = other
            serverURL = other
        } else {
            lastError = ConnectionError.unreachable.localizedDescription
            return nil
        }
        return Client(serverURL: url, transport: URLSessionTransport(), middlewares: [BearerMiddleware(token: token)])
    }

    private func firstReachable(_ urls: [URL]) async -> URL? {
        for url in urls where await isReachable(url) { return url }
        return nil
    }

    private func isReachable(_ url: URL) async -> Bool {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        let client = Client(serverURL: url, transport: URLSessionTransport(configuration: .init(session: URLSession(configuration: configuration))))
        guard let response = try? await client.getHealth(), case .ok = response else { return false }
        return true
    }
}

extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
